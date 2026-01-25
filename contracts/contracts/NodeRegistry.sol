// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NodeRegistry
 * @notice Registry for OtherThing compute nodes with staking
 * @dev Nodes stake OTT to participate, earn rewards for compute
 */
contract NodeRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable ottToken;

    uint256 public minStake = 1000 * 10**18; // 1000 OTT minimum
    uint256 public rewardRate = 1 * 10**18;  // 1 OTT per compute unit
    uint256 public slashPercent = 10;        // 10% slash for bad behavior

    struct Node {
        address owner;
        uint256 stakedAmount;
        uint256 pendingRewards;
        uint256 totalCompute;      // Total compute units provided
        uint256 reputation;        // 0-10000 (100.00%)
        bool isActive;
        bool isSlashed;
        bytes32 capabilities;      // Packed: cpuCores, memoryGb, gpuCount, hasOllama
        uint256 registeredAt;
        uint256 lastActiveAt;
    }

    // nodeId => Node
    mapping(bytes32 => Node) public nodes;

    // owner => nodeIds
    mapping(address => bytes32[]) public ownerNodes;

    // Authorized compute reporters (orchestrators)
    mapping(address => bool) public reporters;

    bytes32[] public allNodeIds;

    event NodeRegistered(bytes32 indexed nodeId, address indexed owner, uint256 stake);
    event NodeDeactivated(bytes32 indexed nodeId);
    event NodeReactivated(bytes32 indexed nodeId);
    event StakeAdded(bytes32 indexed nodeId, uint256 amount);
    event StakeWithdrawn(bytes32 indexed nodeId, uint256 amount);
    event ComputeReported(bytes32 indexed nodeId, uint256 units, uint256 reward);
    event RewardsClaimed(bytes32 indexed nodeId, address indexed to, uint256 amount);
    event NodeSlashed(bytes32 indexed nodeId, uint256 amount, string reason);
    event ReporterAdded(address indexed reporter);
    event ReporterRemoved(address indexed reporter);

    constructor(address _ottToken) Ownable(msg.sender) {
        ottToken = IERC20(_ottToken);
    }

    modifier onlyReporter() {
        require(reporters[msg.sender] || msg.sender == owner(), "NodeRegistry: not a reporter");
        _;
    }

    modifier onlyNodeOwner(bytes32 nodeId) {
        require(nodes[nodeId].owner == msg.sender, "NodeRegistry: not node owner");
        _;
    }

    /**
     * @notice Register a new compute node
     * @param nodeId Unique identifier for the node (e.g., keccak256 of hardware fingerprint)
     * @param stake Amount of OTT to stake
     * @param capabilities Packed capabilities (cpuCores, memoryGb, gpuCount, flags)
     */
    function registerNode(
        bytes32 nodeId,
        uint256 stake,
        bytes32 capabilities
    ) external nonReentrant {
        require(nodes[nodeId].owner == address(0), "NodeRegistry: node already exists");
        require(stake >= minStake, "NodeRegistry: stake too low");

        ottToken.safeTransferFrom(msg.sender, address(this), stake);

        nodes[nodeId] = Node({
            owner: msg.sender,
            stakedAmount: stake,
            pendingRewards: 0,
            totalCompute: 0,
            reputation: 10000, // Start at 100%
            isActive: true,
            isSlashed: false,
            capabilities: capabilities,
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp
        });

        ownerNodes[msg.sender].push(nodeId);
        allNodeIds.push(nodeId);

        emit NodeRegistered(nodeId, msg.sender, stake);
    }

    /**
     * @notice Add more stake to a node
     */
    function addStake(bytes32 nodeId, uint256 amount) external nonReentrant onlyNodeOwner(nodeId) {
        ottToken.safeTransferFrom(msg.sender, address(this), amount);
        nodes[nodeId].stakedAmount += amount;
        emit StakeAdded(nodeId, amount);
    }

    /**
     * @notice Withdraw stake (deactivates node if below minimum)
     */
    function withdrawStake(bytes32 nodeId, uint256 amount) external nonReentrant onlyNodeOwner(nodeId) {
        Node storage node = nodes[nodeId];
        require(node.stakedAmount >= amount, "NodeRegistry: insufficient stake");

        node.stakedAmount -= amount;

        if (node.stakedAmount < minStake) {
            node.isActive = false;
            emit NodeDeactivated(nodeId);
        }

        ottToken.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(nodeId, amount);
    }

    /**
     * @notice Deactivate a node (keeps stake, stops earning)
     */
    function deactivateNode(bytes32 nodeId) external onlyNodeOwner(nodeId) {
        nodes[nodeId].isActive = false;
        emit NodeDeactivated(nodeId);
    }

    /**
     * @notice Reactivate a node
     */
    function reactivateNode(bytes32 nodeId) external onlyNodeOwner(nodeId) {
        Node storage node = nodes[nodeId];
        require(node.stakedAmount >= minStake, "NodeRegistry: stake too low");
        require(!node.isSlashed, "NodeRegistry: node is slashed");
        node.isActive = true;
        node.lastActiveAt = block.timestamp;
        emit NodeReactivated(nodeId);
    }

    /**
     * @notice Report compute work done by a node (called by orchestrator)
     * @param nodeId The node that did the work
     * @param computeUnits Amount of compute (e.g., seconds of GPU time)
     */
    function reportCompute(bytes32 nodeId, uint256 computeUnits) external onlyReporter {
        Node storage node = nodes[nodeId];
        require(node.isActive, "NodeRegistry: node not active");

        uint256 reward = computeUnits * rewardRate / 10**18;
        node.pendingRewards += reward;
        node.totalCompute += computeUnits;
        node.lastActiveAt = block.timestamp;

        emit ComputeReported(nodeId, computeUnits, reward);
    }

    /**
     * @notice Claim pending rewards
     */
    function claimRewards(bytes32 nodeId) external nonReentrant onlyNodeOwner(nodeId) {
        Node storage node = nodes[nodeId];
        uint256 rewards = node.pendingRewards;
        require(rewards > 0, "NodeRegistry: no rewards");

        node.pendingRewards = 0;

        // Mint rewards (requires NodeRegistry to be a minter on OTT)
        // For now, transfer from contract balance (owner must fund)
        ottToken.safeTransfer(msg.sender, rewards);

        emit RewardsClaimed(nodeId, msg.sender, rewards);
    }

    /**
     * @notice Slash a node for bad behavior
     */
    function slashNode(bytes32 nodeId, string calldata reason) external onlyOwner {
        Node storage node = nodes[nodeId];
        require(!node.isSlashed, "NodeRegistry: already slashed");

        uint256 slashAmount = (node.stakedAmount * slashPercent) / 100;
        node.stakedAmount -= slashAmount;
        node.isSlashed = true;
        node.isActive = false;
        node.reputation = 0;

        // Burned (sent to zero address equivalent - kept in contract)
        emit NodeSlashed(nodeId, slashAmount, reason);
    }

    /**
     * @notice Update reputation based on performance
     */
    function updateReputation(bytes32 nodeId, uint256 newReputation) external onlyReporter {
        require(newReputation <= 10000, "NodeRegistry: invalid reputation");
        nodes[nodeId].reputation = newReputation;
    }

    // Admin functions
    function addReporter(address reporter) external onlyOwner {
        reporters[reporter] = true;
        emit ReporterAdded(reporter);
    }

    function removeReporter(address reporter) external onlyOwner {
        reporters[reporter] = false;
        emit ReporterRemoved(reporter);
    }

    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
    }

    function setRewardRate(uint256 _rewardRate) external onlyOwner {
        rewardRate = _rewardRate;
    }

    function setSlashPercent(uint256 _slashPercent) external onlyOwner {
        require(_slashPercent <= 100, "NodeRegistry: invalid percent");
        slashPercent = _slashPercent;
    }

    // View functions
    function getNode(bytes32 nodeId) external view returns (Node memory) {
        return nodes[nodeId];
    }

    function getOwnerNodes(address owner) external view returns (bytes32[] memory) {
        return ownerNodes[owner];
    }

    function getTotalNodes() external view returns (uint256) {
        return allNodeIds.length;
    }

    function isNodeEligible(bytes32 nodeId) external view returns (bool) {
        Node storage node = nodes[nodeId];
        return node.isActive && !node.isSlashed && node.stakedAmount >= minStake;
    }
}
