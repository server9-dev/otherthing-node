// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IWorkspaceRegistry.sol";

/**
 * @title AgreementRegistry
 * @notice Manages legal agreements (NDA, TOS, IP Assignment) per workspace
 * @dev Workspace members can create agreements and sign them on-chain
 */
contract AgreementRegistry is ReentrancyGuard {

    // ============ Enums ============

    enum AgreementType { NDA, TOS, IPAssignment, Custom }

    // ============ Structs ============

    struct Agreement {
        uint256 id;
        bytes32 workspaceId;
        bytes32 documentHash;
        string title;
        AgreementType agreementType;
        address creator;
        uint256 expiresAt;
        bool required;
        uint256 createdAt;
    }

    struct Signature {
        address signer;
        uint256 signedAt;
    }

    // ============ State Variables ============

    IWorkspaceRegistry public immutable workspaceRegistry;

    // Agreement ID counter
    uint256 private _nextAgreementId;

    // Agreement ID => Agreement
    mapping(uint256 => Agreement) private _agreements;

    // Agreement ID => signer address => Signature
    mapping(uint256 => mapping(address => Signature)) private _signatures;

    // Agreement ID => array of signer addresses
    mapping(uint256 => address[]) private _agreementSigners;

    // Workspace ID => array of agreement IDs
    mapping(bytes32 => uint256[]) private _workspaceAgreements;

    // ============ Events ============

    event AgreementCreated(
        uint256 indexed agreementId,
        bytes32 indexed workspaceId,
        bytes32 documentHash
    );

    event AgreementSigned(
        uint256 indexed agreementId,
        address indexed signer
    );

    // ============ Constructor ============

    constructor(address _workspaceRegistry) {
        workspaceRegistry = IWorkspaceRegistry(_workspaceRegistry);
    }

    // ============ External Functions ============

    /**
     * @notice Create a new agreement for a workspace
     * @param workspaceId The workspace this agreement belongs to
     * @param documentHash Hash of the agreement document (e.g., IPFS CID as bytes32)
     * @param title Human-readable title
     * @param agreementType Type of agreement (NDA, TOS, IPAssignment, Custom)
     * @param expiresAt Expiration timestamp (0 for no expiration)
     * @param required Whether all workspace members must sign this
     */
    function createAgreement(
        bytes32 workspaceId,
        bytes32 documentHash,
        string calldata title,
        uint8 agreementType,
        uint256 expiresAt,
        bool required
    ) external nonReentrant returns (uint256) {
        require(workspaceRegistry.isMember(workspaceId, msg.sender), "AgreementRegistry: not a member");
        require(agreementType <= uint8(AgreementType.Custom), "AgreementRegistry: invalid type");
        require(documentHash != bytes32(0), "AgreementRegistry: empty document hash");
        require(bytes(title).length > 0, "AgreementRegistry: empty title");

        uint256 agreementId = _nextAgreementId++;

        _agreements[agreementId] = Agreement({
            id: agreementId,
            workspaceId: workspaceId,
            documentHash: documentHash,
            title: title,
            agreementType: AgreementType(agreementType),
            creator: msg.sender,
            expiresAt: expiresAt,
            required: required,
            createdAt: block.timestamp
        });

        _workspaceAgreements[workspaceId].push(agreementId);

        emit AgreementCreated(agreementId, workspaceId, documentHash);
        return agreementId;
    }

    /**
     * @notice Sign an agreement
     * @param agreementId The agreement to sign
     */
    function signAgreement(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _agreements[agreementId];
        require(agreement.createdAt != 0, "AgreementRegistry: agreement not found");
        require(
            workspaceRegistry.isMember(agreement.workspaceId, msg.sender),
            "AgreementRegistry: not a member"
        );
        require(
            _signatures[agreementId][msg.sender].signedAt == 0,
            "AgreementRegistry: already signed"
        );
        require(
            agreement.expiresAt == 0 || block.timestamp < agreement.expiresAt,
            "AgreementRegistry: agreement expired"
        );

        _signatures[agreementId][msg.sender] = Signature({
            signer: msg.sender,
            signedAt: block.timestamp
        });

        _agreementSigners[agreementId].push(msg.sender);

        emit AgreementSigned(agreementId, msg.sender);
    }

    // ============ View Functions ============

    /**
     * @notice Check if a user has signed all required (non-expired) agreements for a workspace
     * @param workspaceId The workspace to check
     * @param user The user address
     * @return True if all required agreements are signed
     */
    function hasSignedRequired(bytes32 workspaceId, address user) external view returns (bool) {
        uint256[] storage agreementIds = _workspaceAgreements[workspaceId];

        for (uint256 i = 0; i < agreementIds.length; i++) {
            Agreement storage agreement = _agreements[agreementIds[i]];

            // Skip non-required agreements
            if (!agreement.required) continue;

            // Skip expired agreements
            if (agreement.expiresAt != 0 && block.timestamp >= agreement.expiresAt) continue;

            // Check if user has signed this required agreement
            if (_signatures[agreementIds[i]][user].signedAt == 0) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Get all agreement IDs for a workspace
     * @param workspaceId The workspace ID
     * @return Array of agreement IDs
     */
    function getAgreements(bytes32 workspaceId) external view returns (uint256[] memory) {
        return _workspaceAgreements[workspaceId];
    }

    /**
     * @notice Get agreement details
     * @param agreementId The agreement ID
     * @return The agreement struct
     */
    function getAgreement(uint256 agreementId) external view returns (Agreement memory) {
        require(_agreements[agreementId].createdAt != 0, "AgreementRegistry: not found");
        return _agreements[agreementId];
    }

    /**
     * @notice Get all signers for an agreement
     * @param agreementId The agreement ID
     * @return Array of signer addresses
     */
    function getSignatures(uint256 agreementId) external view returns (address[] memory) {
        return _agreementSigners[agreementId];
    }

    /**
     * @notice Check if a specific user has signed an agreement
     * @param agreementId The agreement ID
     * @param user The user address
     * @return True if the user has signed
     */
    function hasSigned(uint256 agreementId, address user) external view returns (bool) {
        return _signatures[agreementId][user].signedAt != 0;
    }
}
