// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TaskEscrow
 * @notice Escrow contract for OtherThing compute tasks
 * @dev Handles payment flow: deposit -> execute -> release/refund
 */
contract TaskEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable ottToken;

    uint256 public platformFeePercent = 5; // 5% platform fee
    uint256 public disputeTimeout = 24 hours;

    enum TaskStatus {
        Created,
        Assigned,
        Completed,
        Disputed,
        Refunded,
        Released
    }

    struct Task {
        address requester;
        bytes32 nodeId;
        uint256 amount;
        uint256 platformFee;
        TaskStatus status;
        bytes32 resultHash;      // IPFS hash of result
        uint256 createdAt;
        uint256 completedAt;
        string description;
    }

    // taskId => Task
    mapping(bytes32 => Task) public tasks;

    // Authorized task managers (orchestrators)
    mapping(address => bool) public managers;

    // Platform fee recipient
    address public feeRecipient;

    bytes32[] public allTaskIds;

    event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 amount);
    event TaskAssigned(bytes32 indexed taskId, bytes32 indexed nodeId);
    event TaskCompleted(bytes32 indexed taskId, bytes32 resultHash);
    event TaskDisputed(bytes32 indexed taskId, address indexed disputer);
    event TaskRefunded(bytes32 indexed taskId, uint256 amount);
    event TaskReleased(bytes32 indexed taskId, address indexed nodeOwner, uint256 amount);
    event ManagerAdded(address indexed manager);
    event ManagerRemoved(address indexed manager);

    constructor(address _ottToken, address _feeRecipient) Ownable(msg.sender) {
        ottToken = IERC20(_ottToken);
        feeRecipient = _feeRecipient;
    }

    modifier onlyManager() {
        require(managers[msg.sender] || msg.sender == owner(), "TaskEscrow: not a manager");
        _;
    }

    modifier onlyRequester(bytes32 taskId) {
        require(tasks[taskId].requester == msg.sender, "TaskEscrow: not requester");
        _;
    }

    /**
     * @notice Create a new task with escrowed payment
     * @param taskId Unique identifier for the task
     * @param amount Payment amount in OTT
     * @param description Task description (stored on-chain for transparency)
     */
    function createTask(
        bytes32 taskId,
        uint256 amount,
        string calldata description
    ) external nonReentrant {
        require(tasks[taskId].requester == address(0), "TaskEscrow: task exists");
        require(amount > 0, "TaskEscrow: zero amount");

        uint256 fee = (amount * platformFeePercent) / 100;
        uint256 total = amount + fee;

        ottToken.safeTransferFrom(msg.sender, address(this), total);

        tasks[taskId] = Task({
            requester: msg.sender,
            nodeId: bytes32(0),
            amount: amount,
            platformFee: fee,
            status: TaskStatus.Created,
            resultHash: bytes32(0),
            createdAt: block.timestamp,
            completedAt: 0,
            description: description
        });

        allTaskIds.push(taskId);

        emit TaskCreated(taskId, msg.sender, amount);
    }

    /**
     * @notice Assign a task to a node (called by orchestrator)
     */
    function assignTask(bytes32 taskId, bytes32 nodeId) external onlyManager {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Created, "TaskEscrow: invalid status");

        task.nodeId = nodeId;
        task.status = TaskStatus.Assigned;

        emit TaskAssigned(taskId, nodeId);
    }

    /**
     * @notice Mark task as completed (called by orchestrator)
     * @param resultHash IPFS CID of the result
     */
    function completeTask(bytes32 taskId, bytes32 resultHash) external onlyManager {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Assigned, "TaskEscrow: not assigned");

        task.resultHash = resultHash;
        task.status = TaskStatus.Completed;
        task.completedAt = block.timestamp;

        emit TaskCompleted(taskId, resultHash);
    }

    /**
     * @notice Release payment to node owner (after completion)
     * @param nodeOwner Address of the node owner to pay
     */
    function releasePayment(bytes32 taskId, address nodeOwner) external onlyManager nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Completed, "TaskEscrow: not completed");

        task.status = TaskStatus.Released;

        // Pay node owner
        ottToken.safeTransfer(nodeOwner, task.amount);

        // Pay platform fee
        if (task.platformFee > 0) {
            ottToken.safeTransfer(feeRecipient, task.platformFee);
        }

        emit TaskReleased(taskId, nodeOwner, task.amount);
    }

    /**
     * @notice Dispute a task (requester only, before release)
     */
    function disputeTask(bytes32 taskId) external onlyRequester(taskId) {
        Task storage task = tasks[taskId];
        require(
            task.status == TaskStatus.Assigned || task.status == TaskStatus.Completed,
            "TaskEscrow: cannot dispute"
        );

        task.status = TaskStatus.Disputed;

        emit TaskDisputed(taskId, msg.sender);
    }

    /**
     * @notice Refund a task (for cancelled/disputed tasks)
     */
    function refundTask(bytes32 taskId) external onlyManager nonReentrant {
        Task storage task = tasks[taskId];
        require(
            task.status == TaskStatus.Created ||
            task.status == TaskStatus.Disputed,
            "TaskEscrow: cannot refund"
        );

        task.status = TaskStatus.Refunded;

        // Refund full amount + fee to requester
        uint256 refundAmount = task.amount + task.platformFee;
        ottToken.safeTransfer(task.requester, refundAmount);

        emit TaskRefunded(taskId, refundAmount);
    }

    /**
     * @notice Cancel a task before assignment (requester only)
     */
    function cancelTask(bytes32 taskId) external nonReentrant onlyRequester(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Created, "TaskEscrow: cannot cancel");

        task.status = TaskStatus.Refunded;

        uint256 refundAmount = task.amount + task.platformFee;
        ottToken.safeTransfer(msg.sender, refundAmount);

        emit TaskRefunded(taskId, refundAmount);
    }

    // Admin functions
    function addManager(address manager) external onlyOwner {
        managers[manager] = true;
        emit ManagerAdded(manager);
    }

    function removeManager(address manager) external onlyOwner {
        managers[manager] = false;
        emit ManagerRemoved(manager);
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }

    function setPlatformFeePercent(uint256 _percent) external onlyOwner {
        require(_percent <= 20, "TaskEscrow: fee too high");
        platformFeePercent = _percent;
    }

    function setDisputeTimeout(uint256 _timeout) external onlyOwner {
        disputeTimeout = _timeout;
    }

    // View functions
    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getTotalTasks() external view returns (uint256) {
        return allTaskIds.length;
    }
}
