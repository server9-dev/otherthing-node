// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/INodeRegistry.sol";
import "./interfaces/IAgreementRegistry.sol";
import "./interfaces/IIPRegistry.sol";

/**
 * @title MilestoneEscrow
 * @notice Escrow contract with milestone-based payments for OtherThing workspace tasks
 * @dev Integrates with NodeRegistry, AgreementRegistry, and IPRegistry for eligibility checks
 */
contract MilestoneEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum TaskStatus { Created, Assigned, InProgress, Completed, Disputed, Cancelled }
    enum MilestoneStatus { Pending, Submitted, Approved, Paid, Disputed }

    // ============ Structs ============

    struct Task {
        bytes32 id;
        address creator;
        address worker;
        bytes32 workspaceId;
        string descriptionCid;
        uint256 deadline;
        TaskStatus status;
        uint256 totalAmount;
        uint256 platformFee;
        uint256 milestoneCount;
        uint256 createdAt;
    }

    struct Milestone {
        string description;
        uint256 amount;
        MilestoneStatus status;
        string workCid;
        uint256 submittedAt;
        uint256 approvedAt;
    }

    // ============ State Variables ============

    IERC20 public immutable ottToken;
    INodeRegistry public immutable nodeRegistry;
    IAgreementRegistry public immutable agreementRegistry;
    IIPRegistry public immutable ipRegistry;

    uint256 public platformFeePercent = 5; // 5%
    uint256 public constant DISPUTE_WINDOW = 3 days;

    // Platform fee recipient
    address public feeRecipient;

    // Task ID => Task
    mapping(bytes32 => Task) private _tasks;

    // Task ID => milestone index => Milestone
    mapping(bytes32 => mapping(uint256 => Milestone)) private _milestones;

    // Worker address => array of task IDs
    mapping(address => bytes32[]) private _workerTasks;

    // Creator address => array of task IDs
    mapping(address => bytes32[]) private _creatorTasks;

    // ============ Events ============

    event TaskCreated(
        bytes32 indexed taskId,
        bytes32 indexed workspaceId,
        address indexed creator,
        uint256 totalAmount,
        uint256 milestoneCount
    );

    event WorkerAssigned(
        bytes32 indexed taskId,
        address indexed worker,
        bytes32 indexed nodeId
    );

    event MilestoneSubmitted(
        bytes32 indexed taskId,
        uint256 indexed milestoneIndex,
        string workCid
    );

    event MilestoneApproved(
        bytes32 indexed taskId,
        uint256 indexed milestoneIndex
    );

    event MilestonePaymentReleased(
        bytes32 indexed taskId,
        uint256 indexed milestoneIndex,
        address indexed worker,
        uint256 amount
    );

    event MilestoneDisputed(
        bytes32 indexed taskId,
        uint256 indexed milestoneIndex
    );

    event TaskCancelled(
        bytes32 indexed taskId,
        uint256 refundAmount
    );

    // ============ Constructor ============

    constructor(
        address _ottToken,
        address _nodeRegistry,
        address _agreementRegistry,
        address _ipRegistry
    ) Ownable(msg.sender) {
        ottToken = IERC20(_ottToken);
        nodeRegistry = INodeRegistry(_nodeRegistry);
        agreementRegistry = IAgreementRegistry(_agreementRegistry);
        ipRegistry = IIPRegistry(_ipRegistry);
        feeRecipient = msg.sender;
    }

    // ============ External Functions ============

    /**
     * @notice Create a new milestone-based task with escrowed payment
     * @param workspaceId The workspace this task belongs to
     * @param descriptionCid IPFS CID of the task description
     * @param deadline Task deadline timestamp
     * @param milestoneDescriptions Array of milestone descriptions
     * @param milestoneAmounts Array of milestone payment amounts
     */
    function createTask(
        bytes32 workspaceId,
        string calldata descriptionCid,
        uint256 deadline,
        string[] calldata milestoneDescriptions,
        uint256[] calldata milestoneAmounts
    ) external nonReentrant returns (bytes32) {
        require(milestoneDescriptions.length > 0, "MilestoneEscrow: no milestones");
        require(
            milestoneDescriptions.length == milestoneAmounts.length,
            "MilestoneEscrow: array length mismatch"
        );
        require(deadline > block.timestamp, "MilestoneEscrow: deadline in the past");

        // Calculate total amount
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            require(milestoneAmounts[i] > 0, "MilestoneEscrow: zero milestone amount");
            totalAmount += milestoneAmounts[i];
        }

        uint256 fee = (totalAmount * platformFeePercent) / 100;
        uint256 totalRequired = totalAmount + fee;

        // Generate task ID
        bytes32 taskId = keccak256(abi.encodePacked(
            msg.sender,
            workspaceId,
            block.timestamp,
            _creatorTasks[msg.sender].length
        ));

        require(_tasks[taskId].createdAt == 0, "MilestoneEscrow: task exists");

        // Escrow tokens
        ottToken.safeTransferFrom(msg.sender, address(this), totalRequired);

        // Create task
        _tasks[taskId] = Task({
            id: taskId,
            creator: msg.sender,
            worker: address(0),
            workspaceId: workspaceId,
            descriptionCid: descriptionCid,
            deadline: deadline,
            status: TaskStatus.Created,
            totalAmount: totalAmount,
            platformFee: fee,
            milestoneCount: milestoneDescriptions.length,
            createdAt: block.timestamp
        });

        // Create milestones
        for (uint256 i = 0; i < milestoneDescriptions.length; i++) {
            _milestones[taskId][i] = Milestone({
                description: milestoneDescriptions[i],
                amount: milestoneAmounts[i],
                status: MilestoneStatus.Pending,
                workCid: "",
                submittedAt: 0,
                approvedAt: 0
            });
        }

        _creatorTasks[msg.sender].push(taskId);

        emit TaskCreated(taskId, workspaceId, msg.sender, totalAmount, milestoneDescriptions.length);
        return taskId;
    }

    /**
     * @notice Assign a worker to a task
     * @param taskId The task ID
     * @param workerAddress The worker's address
     * @param nodeId The worker's registered node ID
     */
    function assignWorker(
        bytes32 taskId,
        address workerAddress,
        bytes32 nodeId
    ) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.createdAt != 0, "MilestoneEscrow: task not found");
        require(task.creator == msg.sender, "MilestoneEscrow: not creator");
        require(task.status == TaskStatus.Created, "MilestoneEscrow: invalid status");
        require(workerAddress != address(0), "MilestoneEscrow: zero address");

        // Check node eligibility
        require(
            nodeRegistry.isNodeEligible(nodeId),
            "MilestoneEscrow: node not eligible"
        );

        // Check worker has signed required agreements
        require(
            agreementRegistry.hasSignedRequired(task.workspaceId, workerAddress),
            "MilestoneEscrow: agreements not signed"
        );

        task.worker = workerAddress;
        task.status = TaskStatus.Assigned;

        _workerTasks[workerAddress].push(taskId);

        emit WorkerAssigned(taskId, workerAddress, nodeId);
    }

    /**
     * @notice Submit work for a milestone
     * @param taskId The task ID
     * @param milestoneIndex The milestone index
     * @param workCid IPFS CID of the submitted work
     */
    function submitMilestone(
        bytes32 taskId,
        uint256 milestoneIndex,
        string calldata workCid
    ) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.createdAt != 0, "MilestoneEscrow: task not found");
        require(task.worker == msg.sender, "MilestoneEscrow: not worker");
        require(
            task.status == TaskStatus.Assigned || task.status == TaskStatus.InProgress,
            "MilestoneEscrow: invalid status"
        );
        require(milestoneIndex < task.milestoneCount, "MilestoneEscrow: invalid milestone");
        require(bytes(workCid).length > 0, "MilestoneEscrow: empty work CID");

        Milestone storage milestone = _milestones[taskId][milestoneIndex];
        require(
            milestone.status == MilestoneStatus.Pending,
            "MilestoneEscrow: milestone not pending"
        );

        milestone.workCid = workCid;
        milestone.status = MilestoneStatus.Submitted;
        milestone.submittedAt = block.timestamp;

        // Move task to InProgress if it was Assigned
        if (task.status == TaskStatus.Assigned) {
            task.status = TaskStatus.InProgress;
        }

        emit MilestoneSubmitted(taskId, milestoneIndex, workCid);
    }

    /**
     * @notice Approve a submitted milestone
     * @param taskId The task ID
     * @param milestoneIndex The milestone index
     */
    function approveMilestone(
        bytes32 taskId,
        uint256 milestoneIndex
    ) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.createdAt != 0, "MilestoneEscrow: task not found");
        require(task.creator == msg.sender, "MilestoneEscrow: not creator");
        require(milestoneIndex < task.milestoneCount, "MilestoneEscrow: invalid milestone");

        Milestone storage milestone = _milestones[taskId][milestoneIndex];
        require(
            milestone.status == MilestoneStatus.Submitted,
            "MilestoneEscrow: milestone not submitted"
        );

        milestone.status = MilestoneStatus.Approved;
        milestone.approvedAt = block.timestamp;

        emit MilestoneApproved(taskId, milestoneIndex);
    }

    /**
     * @notice Release payment for an approved milestone
     * @param taskId The task ID
     * @param milestoneIndex The milestone index
     */
    function releaseMilestonePayment(
        bytes32 taskId,
        uint256 milestoneIndex
    ) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.createdAt != 0, "MilestoneEscrow: task not found");
        require(task.creator == msg.sender, "MilestoneEscrow: not creator");
        require(milestoneIndex < task.milestoneCount, "MilestoneEscrow: invalid milestone");

        Milestone storage milestone = _milestones[taskId][milestoneIndex];
        require(
            milestone.status == MilestoneStatus.Approved,
            "MilestoneEscrow: milestone not approved"
        );

        // For the final milestone, require IP registration
        bool isFinalMilestone = _isLastMilestone(taskId, milestoneIndex);
        if (isFinalMilestone) {
            require(
                ipRegistry.hasIPRegistered(taskId),
                "MilestoneEscrow: IP not registered for task"
            );
        }

        milestone.status = MilestoneStatus.Paid;

        // Transfer milestone amount to worker
        ottToken.safeTransfer(task.worker, milestone.amount);

        // If this is the final milestone being paid, also transfer platform fee and mark task completed
        if (isFinalMilestone) {
            task.status = TaskStatus.Completed;
            if (task.platformFee > 0) {
                ottToken.safeTransfer(feeRecipient, task.platformFee);
            }
        }

        emit MilestonePaymentReleased(taskId, milestoneIndex, task.worker, milestone.amount);
    }

    /**
     * @notice Dispute a submitted milestone (creator only, within dispute window)
     * @param taskId The task ID
     * @param milestoneIndex The milestone index
     */
    function disputeMilestone(
        bytes32 taskId,
        uint256 milestoneIndex
    ) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.createdAt != 0, "MilestoneEscrow: task not found");
        require(task.creator == msg.sender, "MilestoneEscrow: not creator");
        require(milestoneIndex < task.milestoneCount, "MilestoneEscrow: invalid milestone");

        Milestone storage milestone = _milestones[taskId][milestoneIndex];
        require(
            milestone.status == MilestoneStatus.Submitted,
            "MilestoneEscrow: milestone not submitted"
        );
        require(
            block.timestamp <= milestone.submittedAt + DISPUTE_WINDOW,
            "MilestoneEscrow: dispute window closed"
        );

        milestone.status = MilestoneStatus.Disputed;
        task.status = TaskStatus.Disputed;

        emit MilestoneDisputed(taskId, milestoneIndex);
    }

    /**
     * @notice Cancel a task before assignment and refund escrowed tokens
     * @param taskId The task ID
     */
    function cancelTask(bytes32 taskId) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.createdAt != 0, "MilestoneEscrow: task not found");
        require(task.creator == msg.sender, "MilestoneEscrow: not creator");
        require(task.status == TaskStatus.Created, "MilestoneEscrow: task already assigned");

        task.status = TaskStatus.Cancelled;

        uint256 refundAmount = task.totalAmount + task.platformFee;
        ottToken.safeTransfer(task.creator, refundAmount);

        emit TaskCancelled(taskId, refundAmount);
    }

    // ============ Admin Functions ============

    function setPlatformFeePercent(uint256 _percent) external onlyOwner {
        require(_percent <= 20, "MilestoneEscrow: fee too high");
        platformFeePercent = _percent;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "MilestoneEscrow: zero address");
        feeRecipient = _feeRecipient;
    }

    // ============ View Functions ============

    /**
     * @notice Get task details
     * @param taskId The task ID
     * @return The task struct
     */
    function getTask(bytes32 taskId) external view returns (Task memory) {
        require(_tasks[taskId].createdAt != 0, "MilestoneEscrow: task not found");
        return _tasks[taskId];
    }

    /**
     * @notice Get all milestones for a task
     * @param taskId The task ID
     * @return Array of milestones
     */
    function getMilestones(bytes32 taskId) external view returns (Milestone[] memory) {
        Task storage task = _tasks[taskId];
        require(task.createdAt != 0, "MilestoneEscrow: task not found");

        Milestone[] memory milestones = new Milestone[](task.milestoneCount);
        for (uint256 i = 0; i < task.milestoneCount; i++) {
            milestones[i] = _milestones[taskId][i];
        }
        return milestones;
    }

    /**
     * @notice Get all task IDs for a worker
     * @param worker The worker address
     * @return Array of task IDs
     */
    function getWorkerTasks(address worker) external view returns (bytes32[] memory) {
        return _workerTasks[worker];
    }

    /**
     * @notice Get all task IDs for a creator
     * @param creator The creator address
     * @return Array of task IDs
     */
    function getCreatorTasks(address creator) external view returns (bytes32[] memory) {
        return _creatorTasks[creator];
    }

    // ============ Internal Functions ============

    /**
     * @dev Check if a milestone is the last one and all previous milestones are paid
     */
    function _isLastMilestone(bytes32 taskId, uint256 milestoneIndex) internal view returns (bool) {
        Task storage task = _tasks[taskId];

        // Check if this is the last milestone index
        if (milestoneIndex != task.milestoneCount - 1) {
            return false;
        }

        // Verify all previous milestones are paid
        for (uint256 i = 0; i < milestoneIndex; i++) {
            if (_milestones[taskId][i].status != MilestoneStatus.Paid) {
                return false;
            }
        }

        return true;
    }
}
