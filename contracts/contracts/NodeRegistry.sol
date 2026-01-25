// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NodeRegistry
 * @notice Registry for OtherThing compute nodes with staking
 */
contract NodeRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable ottToken;

    uint256 public minStake = 100 * 10**18; // 100 OTT minimum
    uint256 public rewardRate = 1 * 10**15; // 0.001 OTT per compute second

    struct Capabilities {
        uint32 cpuCores;
        uint32 memoryMb;
        uint32 gpuCount;
        uint32 gpuVramMb;
        bool hasOllama;
        bool hasSandbox;
    }

    struct Node {
        address owner;
        uint256 stakedAmount;
        uint256 pendingRewards;
        uint256 totalEarned;
        uint256 totalComputeSeconds;
        uint256 reputation;
        uint256 registeredAt;
        uint256 lastActiveAt;
        bool isActive;
        bool isSlashed;
        Capabilities capabilities;
        string endpoint;
    }

    mapping(bytes32 => Node) private _nodes;
    mapping(address => bytes32[]) public ownerNodes;
    mapping(address => bool) public authorizedReporters;

    bytes32[] public allNodeIds;
    uint256 private nodeCounter;

    event NodeRegistered(bytes32 indexed nodeId, address indexed owner, uint256 stake);
    event NodeDeactivated(bytes32 indexed nodeId);
    event NodeReactivated(bytes32 indexed nodeId);
    event StakeAdded(bytes32 indexed nodeId, uint256 amount);
    event StakeWithdrawn(bytes32 indexed nodeId, uint256 amount);
    event ComputeReported(bytes32 indexed nodeId, uint256 seconds_, uint256 reward);
    event RewardsClaimed(bytes32 indexed nodeId, address indexed to, uint256 amount);
    event ReporterAdded(address indexed reporter);
    event ReporterRemoved(address indexed reporter);

    constructor(address _ottToken) Ownable(msg.sender) {
        ottToken = IERC20(_ottToken);
    }

    function registerNode(
        Capabilities calldata capabilities,
        string calldata endpoint,
        uint256 stakeAmount
    ) external nonReentrant returns (bytes32) {
        require(stakeAmount >= minStake, "Stake too low");

        ottToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        nodeCounter++;
        bytes32 nodeId = keccak256(abi.encodePacked(msg.sender, block.timestamp, nodeCounter));

        _nodes[nodeId] = Node({
            owner: msg.sender,
            stakedAmount: stakeAmount,
            pendingRewards: 0,
            totalEarned: 0,
            totalComputeSeconds: 0,
            reputation: 10000,
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp,
            isActive: true,
            isSlashed: false,
            capabilities: capabilities,
            endpoint: endpoint
        });

        ownerNodes[msg.sender].push(nodeId);
        allNodeIds.push(nodeId);

        emit NodeRegistered(nodeId, msg.sender, stakeAmount);
        return nodeId;
    }

    function updateEndpoint(bytes32 nodeId, string calldata endpoint) external {
        require(_nodes[nodeId].owner == msg.sender, "Not owner");
        _nodes[nodeId].endpoint = endpoint;
    }

    function updateCapabilities(bytes32 nodeId, Capabilities calldata capabilities) external {
        require(_nodes[nodeId].owner == msg.sender, "Not owner");
        _nodes[nodeId].capabilities = capabilities;
    }

    function addStake(bytes32 nodeId, uint256 amount) external nonReentrant {
        require(_nodes[nodeId].owner == msg.sender, "Not owner");
        ottToken.safeTransferFrom(msg.sender, address(this), amount);
        _nodes[nodeId].stakedAmount += amount;
        emit StakeAdded(nodeId, amount);
    }

    function withdrawStake(bytes32 nodeId, uint256 amount) external nonReentrant {
        Node storage node = _nodes[nodeId];
        require(node.owner == msg.sender, "Not owner");
        require(node.stakedAmount >= amount, "Insufficient stake");

        node.stakedAmount -= amount;
        if (node.stakedAmount < minStake) {
            node.isActive = false;
            emit NodeDeactivated(nodeId);
        }

        ottToken.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(nodeId, amount);
    }

    function deactivateNode(bytes32 nodeId) external {
        require(_nodes[nodeId].owner == msg.sender, "Not owner");
        _nodes[nodeId].isActive = false;
        emit NodeDeactivated(nodeId);
    }

    function reactivateNode(bytes32 nodeId) external {
        Node storage node = _nodes[nodeId];
        require(node.owner == msg.sender, "Not owner");
        require(node.stakedAmount >= minStake, "Stake too low");
        require(!node.isSlashed, "Node slashed");
        node.isActive = true;
        node.lastActiveAt = block.timestamp;
        emit NodeReactivated(nodeId);
    }

    function reportCompute(bytes32 nodeId, uint256 computeSeconds) external {
        require(authorizedReporters[msg.sender] || msg.sender == owner(), "Not reporter");
        Node storage node = _nodes[nodeId];
        require(node.isActive, "Node not active");

        uint256 reward = computeSeconds * rewardRate;
        node.pendingRewards += reward;
        node.totalComputeSeconds += computeSeconds;
        node.lastActiveAt = block.timestamp;

        emit ComputeReported(nodeId, computeSeconds, reward);
    }

    function claimRewards(bytes32 nodeId) external nonReentrant {
        Node storage node = _nodes[nodeId];
        require(node.owner == msg.sender, "Not owner");
        uint256 rewards = node.pendingRewards;
        require(rewards > 0, "No rewards");

        node.pendingRewards = 0;
        node.totalEarned += rewards;
        ottToken.safeTransfer(msg.sender, rewards);

        emit RewardsClaimed(nodeId, msg.sender, rewards);
    }

    // Admin
    function addReporter(address reporter) external onlyOwner {
        authorizedReporters[reporter] = true;
        emit ReporterAdded(reporter);
    }

    function removeReporter(address reporter) external onlyOwner {
        authorizedReporters[reporter] = false;
        emit ReporterRemoved(reporter);
    }

    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
    }

    function setRewardRate(uint256 _rewardRate) external onlyOwner {
        rewardRate = _rewardRate;
    }

    // View
    function getNode(bytes32 nodeId) external view returns (Node memory) {
        return _nodes[nodeId];
    }

    function getOwnerNodes(address owner_) external view returns (bytes32[] memory) {
        return ownerNodes[owner_];
    }

    function isNodeEligible(bytes32 nodeId) external view returns (bool) {
        Node storage node = _nodes[nodeId];
        return node.isActive && !node.isSlashed && node.stakedAmount >= minStake;
    }

    function getTotalNodes() external view returns (uint256) {
        return allNodeIds.length;
    }
}
