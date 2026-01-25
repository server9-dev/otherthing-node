/**
 * Web3 Service
 *
 * Handles wallet connection and smart contract interactions
 * for the OtherThing protocol.
 */

import { ethers, BrowserProvider, JsonRpcSigner, Contract } from 'ethers';

// Contract addresses (Sepolia testnet)
export const CONTRACT_ADDRESSES = {
  sepolia: {
    OTT: '0x201333A5C882751a98E483f9B763DF4D8e5A1055',
    NodeRegistry: '0xFaCB01A565ea526FC8CAC87D5D4622983735e8F3',
    TaskEscrow: '0x246127F9743AC938baB7fc221546a785C880ad86',
  },
  localhost: {
    OTT: '',
    NodeRegistry: '',
    TaskEscrow: '',
  },
};

// Minimal ABIs for the functions we need
export const OTT_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export const NODE_REGISTRY_ABI = [
  // Structs are returned as tuples
  'function minStake() view returns (uint256)',
  'function rewardPerComputeSecond() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function rewardPool() view returns (uint256)',

  // Node registration
  'function registerNode((uint32 cpuCores, uint32 memoryMb, uint32 gpuCount, uint32 gpuVramMb, bool hasOllama, bool hasSandbox) capabilities, string endpoint, uint256 stakeAmount) returns (bytes32)',
  'function updateEndpoint(bytes32 nodeId, string endpoint)',
  'function updateCapabilities(bytes32 nodeId, (uint32, uint32, uint32, uint32, bool, bool) capabilities)',
  'function deactivateNode(bytes32 nodeId)',
  'function reactivateNode(bytes32 nodeId)',

  // Staking
  'function addStake(bytes32 nodeId, uint256 amount)',
  'function withdrawStake(bytes32 nodeId, uint256 amount)',
  'function claimRewards(bytes32 nodeId)',

  // Compute reporting (requires authorized reporter)
  'function reportCompute(bytes32 nodeId, uint256 computeSeconds)',
  'function authorizedReporters(address) view returns (bool)',

  // View functions
  'function getOwnerNodes(address owner) view returns (bytes32[])',
  'function getNode(bytes32 nodeId) view returns (tuple(address owner, uint256 stakedAmount, uint256 pendingRewards, uint256 totalEarned, uint256 totalComputeSeconds, uint256 reputation, uint256 registeredAt, uint256 lastActiveAt, bool isActive, bool isSlashed, tuple(uint32 cpuCores, uint32 memoryMb, uint32 gpuCount, uint32 gpuVramMb, bool hasOllama, bool hasSandbox) capabilities, string endpoint))',
  'function isNodeEligible(bytes32 nodeId) view returns (bool)',

  // Events
  'event NodeRegistered(bytes32 indexed nodeId, address indexed owner, uint256 stake)',
  'event StakeAdded(bytes32 indexed nodeId, uint256 amount)',
  'event StakeWithdrawn(bytes32 indexed nodeId, uint256 amount)',
  'event RewardsClaimed(bytes32 indexed nodeId, address indexed owner, uint256 amount)',
  'event NodeSlashed(bytes32 indexed nodeId, uint256 amount, string reason)',
];

export const TASK_ESCROW_ABI = [
  // Task creation
  'function createTask(bytes32 workspaceId, string title, string descriptionCid, uint256 bounty, uint256 deadline, string[] milestoneDescriptions, uint256[] milestoneAmounts) returns (bytes32)',
  'function fundTask(bytes32 taskId, uint256 amount)',
  'function cancelTask(bytes32 taskId)',

  // Applications
  'function applyForTask(bytes32 taskId, string applicationCid)',
  'function assignWorker(bytes32 taskId, address worker)',

  // Work submission
  'function submitWork(bytes32 taskId, string workCid)',
  'function approveMilestone(bytes32 taskId, uint256 milestoneIndex)',
  'function approveAllMilestones(bytes32 taskId)',

  // Disputes
  'function raiseDispute(bytes32 taskId)',

  // View functions
  'function getTask(bytes32 taskId) view returns (tuple(bytes32 id, address creator, address worker, string title, string descriptionCid, uint256 totalBounty, uint256 paidOut, uint256 createdAt, uint256 deadline, uint8 status, string workSubmissionCid))',
  'function getTaskMilestones(bytes32 taskId) view returns (tuple(string description, uint256 amount, bool completed, bool paid)[])',
  'function getTaskApplicants(bytes32 taskId) view returns (address[])',
  'function getWorkspaceTasks(bytes32 workspaceId) view returns (bytes32[])',
  'function getCreatorTasks(address creator) view returns (bytes32[])',
  'function getWorkerTasks(address worker) view returns (bytes32[])',
  'function platformFeePercent() view returns (uint256)',

  // Events
  'event TaskCreated(bytes32 indexed taskId, address indexed creator, uint256 bounty)',
  'event WorkerAssigned(bytes32 indexed taskId, address indexed worker)',
  'event WorkSubmitted(bytes32 indexed taskId, string workCid)',
  'event MilestoneCompleted(bytes32 indexed taskId, uint256 milestoneIndex)',
  'event PaymentReleased(bytes32 indexed taskId, address indexed worker, uint256 amount)',
  'event TaskApproved(bytes32 indexed taskId)',
  'event TaskDisputed(bytes32 indexed taskId, address indexed disputer)',
];

// Node capabilities interface
export interface NodeCapabilities {
  cpuCores: number;
  memoryMb: number;
  gpuCount: number;
  gpuVramMb: number;
  hasOllama: boolean;
  hasSandbox: boolean;
}

// Node data interface
export interface OnChainNode {
  nodeId: string;
  owner: string;
  stakedAmount: bigint;
  pendingRewards: bigint;
  totalEarned: bigint;
  totalComputeSeconds: bigint;
  reputation: bigint;
  registeredAt: bigint;
  lastActiveAt: bigint;
  isActive: boolean;
  isSlashed: boolean;
  capabilities: NodeCapabilities;
  endpoint: string;
}

// Task status enum matching contract
export enum TaskStatus {
  Open = 0,
  Assigned = 1,
  Submitted = 2,
  Approved = 3,
  Disputed = 4,
  Cancelled = 5,
  Expired = 6,
}

// Task interface
export interface OnChainTask {
  id: string;
  creator: string;
  worker: string;
  title: string;
  descriptionCid: string;
  totalBounty: bigint;
  paidOut: bigint;
  createdAt: bigint;
  deadline: bigint;
  status: TaskStatus;
  workSubmissionCid: string;
}

// Milestone interface
export interface Milestone {
  description: string;
  amount: bigint;
  completed: boolean;
  paid: boolean;
}

/**
 * Web3 Service class
 */
export class Web3Service {
  private provider: BrowserProvider | ethers.JsonRpcProvider | null = null;
  private signer: JsonRpcSigner | null = null;
  private network: 'sepolia' | 'localhost' = 'sepolia';

  private ottContract: Contract | null = null;
  private nodeRegistryContract: Contract | null = null;
  private taskEscrowContract: Contract | null = null;

  // Connection state
  public connected: boolean = false;
  public address: string | null = null;
  public chainId: number | null = null;

  /**
   * Initialize with a JSON-RPC provider (for server-side use)
   */
  async initWithRpc(rpcUrl: string, network: 'sepolia' | 'localhost' = 'sepolia'): Promise<void> {
    this.network = network;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    const addresses = CONTRACT_ADDRESSES[network];
    if (addresses.OTT) {
      this.ottContract = new Contract(addresses.OTT, OTT_ABI, this.provider);
      this.nodeRegistryContract = new Contract(addresses.NodeRegistry, NODE_REGISTRY_ABI, this.provider);
      this.taskEscrowContract = new Contract(addresses.TaskEscrow, TASK_ESCROW_ABI, this.provider);
    }
  }

  /**
   * Connect to wallet (browser/Electron with injected provider)
   */
  async connectWallet(ethereum: any): Promise<string> {
    if (!ethereum) {
      throw new Error('No wallet found. Please install MetaMask.');
    }

    this.provider = new BrowserProvider(ethereum);

    // Request accounts
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }

    this.signer = await this.provider.getSigner();
    this.address = await this.signer.getAddress();

    const network = await this.provider.getNetwork();
    this.chainId = Number(network.chainId);

    // Determine network
    if (this.chainId === 11155111) {
      this.network = 'sepolia';
    } else if (this.chainId === 31337) {
      this.network = 'localhost';
    }

    // Initialize contracts with signer
    const addresses = CONTRACT_ADDRESSES[this.network];
    if (addresses.OTT) {
      this.ottContract = new Contract(addresses.OTT, OTT_ABI, this.signer);
      this.nodeRegistryContract = new Contract(addresses.NodeRegistry, NODE_REGISTRY_ABI, this.signer);
      this.taskEscrowContract = new Contract(addresses.TaskEscrow, TASK_ESCROW_ABI, this.signer);
    }

    this.connected = true;
    return this.address;
  }

  /**
   * Disconnect wallet
   */
  disconnect(): void {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.connected = false;
    this.ottContract = null;
    this.nodeRegistryContract = null;
    this.taskEscrowContract = null;
  }

  /**
   * Set contract addresses (after deployment)
   */
  setAddresses(network: 'sepolia' | 'localhost', addresses: { OTT: string; NodeRegistry: string; TaskEscrow: string }): void {
    CONTRACT_ADDRESSES[network] = addresses;

    // Reinitialize contracts if connected
    if (this.signer && this.network === network) {
      this.ottContract = new Contract(addresses.OTT, OTT_ABI, this.signer);
      this.nodeRegistryContract = new Contract(addresses.NodeRegistry, NODE_REGISTRY_ABI, this.signer);
      this.taskEscrowContract = new Contract(addresses.TaskEscrow, TASK_ESCROW_ABI, this.signer);
    }
  }

  // ============ Token Functions ============

  async getOttBalance(address?: string): Promise<bigint> {
    if (!this.ottContract) throw new Error('Contracts not initialized');
    const addr = address || this.address;
    if (!addr) throw new Error('No address');
    return await this.ottContract.balanceOf(addr);
  }

  async approveOtt(spender: string, amount: bigint): Promise<ethers.TransactionResponse> {
    if (!this.ottContract) throw new Error('Contracts not initialized');
    return await this.ottContract.approve(spender, amount);
  }

  // ============ Node Registry Functions ============

  async getMinStake(): Promise<bigint> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    return await this.nodeRegistryContract.minStake();
  }

  async registerNode(capabilities: NodeCapabilities, endpoint: string, stakeAmount: bigint): Promise<string> {
    if (!this.nodeRegistryContract || !this.ottContract) throw new Error('Contracts not initialized');

    // First approve the stake
    const addresses = CONTRACT_ADDRESSES[this.network];
    const approveTx = await this.ottContract.approve(addresses.NodeRegistry, stakeAmount);
    await approveTx.wait();

    // Then register
    const tx = await this.nodeRegistryContract.registerNode(
      [
        capabilities.cpuCores,
        capabilities.memoryMb,
        capabilities.gpuCount,
        capabilities.gpuVramMb,
        capabilities.hasOllama,
        capabilities.hasSandbox,
      ],
      endpoint,
      stakeAmount
    );

    const receipt = await tx.wait();

    // Get nodeId from event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = this.nodeRegistryContract!.interface.parseLog(log);
        return parsed?.name === 'NodeRegistered';
      } catch {
        return false;
      }
    });

    if (event) {
      const parsed = this.nodeRegistryContract.interface.parseLog(event);
      return parsed?.args[0]; // nodeId
    }

    throw new Error('NodeRegistered event not found');
  }

  async getMyNodes(): Promise<string[]> {
    if (!this.nodeRegistryContract || !this.address) throw new Error('Not connected');
    return await this.nodeRegistryContract.getOwnerNodes(this.address);
  }

  async getNode(nodeId: string): Promise<OnChainNode> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    const node = await this.nodeRegistryContract.getNode(nodeId);

    return {
      nodeId,
      owner: node[0],
      stakedAmount: node[1],
      pendingRewards: node[2],
      totalEarned: node[3],
      totalComputeSeconds: node[4],
      reputation: node[5],
      registeredAt: node[6],
      lastActiveAt: node[7],
      isActive: node[8],
      isSlashed: node[9],
      capabilities: {
        cpuCores: Number(node[10][0]),
        memoryMb: Number(node[10][1]),
        gpuCount: Number(node[10][2]),
        gpuVramMb: Number(node[10][3]),
        hasOllama: node[10][4],
        hasSandbox: node[10][5],
      },
      endpoint: node[11],
    };
  }

  async claimRewards(nodeId: string): Promise<ethers.TransactionResponse> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    return await this.nodeRegistryContract.claimRewards(nodeId);
  }

  async addStake(nodeId: string, amount: bigint): Promise<ethers.TransactionResponse> {
    if (!this.nodeRegistryContract || !this.ottContract) throw new Error('Contracts not initialized');

    const addresses = CONTRACT_ADDRESSES[this.network];
    const approveTx = await this.ottContract.approve(addresses.NodeRegistry, amount);
    await approveTx.wait();

    return await this.nodeRegistryContract.addStake(nodeId, amount);
  }

  async withdrawStake(nodeId: string, amount: bigint): Promise<ethers.TransactionResponse> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    return await this.nodeRegistryContract.withdrawStake(nodeId, amount);
  }

  /**
   * Report compute time to the blockchain (requires authorized reporter)
   */
  async reportCompute(nodeId: string, computeSeconds: number): Promise<ethers.TransactionResponse> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    return await this.nodeRegistryContract.reportCompute(nodeId, computeSeconds);
  }

  /**
   * Check if an address is an authorized reporter
   */
  async isAuthorizedReporter(address: string): Promise<boolean> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    return await this.nodeRegistryContract.authorizedReporters(address);
  }

  // ============ Task Escrow Functions ============

  async createTask(
    workspaceId: string,
    title: string,
    descriptionCid: string,
    bounty: bigint,
    deadline: number,
    milestones: { description: string; amount: bigint }[]
  ): Promise<string> {
    if (!this.taskEscrowContract || !this.ottContract) throw new Error('Contracts not initialized');

    // Approve bounty
    const addresses = CONTRACT_ADDRESSES[this.network];
    const approveTx = await this.ottContract.approve(addresses.TaskEscrow, bounty);
    await approveTx.wait();

    // Create task
    const workspaceIdBytes = ethers.id(workspaceId);
    const tx = await this.taskEscrowContract.createTask(
      workspaceIdBytes,
      title,
      descriptionCid,
      bounty,
      deadline,
      milestones.map(m => m.description),
      milestones.map(m => m.amount)
    );

    const receipt = await tx.wait();

    // Get taskId from event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = this.taskEscrowContract!.interface.parseLog(log);
        return parsed?.name === 'TaskCreated';
      } catch {
        return false;
      }
    });

    if (event) {
      const parsed = this.taskEscrowContract.interface.parseLog(event);
      return parsed?.args[0]; // taskId
    }

    throw new Error('TaskCreated event not found');
  }

  async getTask(taskId: string): Promise<OnChainTask> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    const task = await this.taskEscrowContract.getTask(taskId);

    return {
      id: task[0],
      creator: task[1],
      worker: task[2],
      title: task[3],
      descriptionCid: task[4],
      totalBounty: task[5],
      paidOut: task[6],
      createdAt: task[7],
      deadline: task[8],
      status: Number(task[9]) as TaskStatus,
      workSubmissionCid: task[10],
    };
  }

  async getTaskMilestones(taskId: string): Promise<Milestone[]> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    const milestones = await this.taskEscrowContract.getTaskMilestones(taskId);

    return milestones.map((m: any) => ({
      description: m[0],
      amount: m[1],
      completed: m[2],
      paid: m[3],
    }));
  }

  async getWorkspaceTasks(workspaceId: string): Promise<string[]> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    const workspaceIdBytes = ethers.id(workspaceId);
    return await this.taskEscrowContract.getWorkspaceTasks(workspaceIdBytes);
  }

  async applyForTask(taskId: string, applicationCid: string): Promise<ethers.TransactionResponse> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    return await this.taskEscrowContract.applyForTask(taskId, applicationCid);
  }

  async assignWorker(taskId: string, worker: string): Promise<ethers.TransactionResponse> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    return await this.taskEscrowContract.assignWorker(taskId, worker);
  }

  async submitWork(taskId: string, workCid: string): Promise<ethers.TransactionResponse> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    return await this.taskEscrowContract.submitWork(taskId, workCid);
  }

  async approveMilestone(taskId: string, milestoneIndex: number): Promise<ethers.TransactionResponse> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    return await this.taskEscrowContract.approveMilestone(taskId, milestoneIndex);
  }

  async approveAllMilestones(taskId: string): Promise<ethers.TransactionResponse> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    return await this.taskEscrowContract.approveAllMilestones(taskId);
  }

  async cancelTask(taskId: string): Promise<ethers.TransactionResponse> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    return await this.taskEscrowContract.cancelTask(taskId);
  }

  async raiseDispute(taskId: string): Promise<ethers.TransactionResponse> {
    if (!this.taskEscrowContract) throw new Error('Contracts not initialized');
    return await this.taskEscrowContract.raiseDispute(taskId);
  }

  // ============ On-Chain Verification Functions ============

  /**
   * Sign a challenge message to prove wallet ownership
   */
  async signChallenge(challenge: string): Promise<string> {
    if (!this.signer) throw new Error('No signer available');
    return await this.signer.signMessage(challenge);
  }

  /**
   * Verify a signature matches an address
   */
  verifySignature(message: string, signature: string, expectedAddress: string): boolean {
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Check if a node is registered on-chain by its nodeId
   */
  async isNodeRegistered(nodeId: string): Promise<boolean> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    try {
      const node = await this.nodeRegistryContract.getNode(nodeId);
      return node[0] !== ethers.ZeroAddress && node[8]; // owner != 0x0 && isActive
    } catch {
      return false;
    }
  }

  /**
   * Check if a node is eligible (active, not slashed, above min stake)
   */
  async isNodeEligible(nodeId: string): Promise<boolean> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    try {
      return await this.nodeRegistryContract.isNodeEligible(nodeId);
    } catch {
      return false;
    }
  }

  /**
   * Get all node IDs owned by an address
   */
  async getNodesByOwner(ownerAddress: string): Promise<string[]> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    return await this.nodeRegistryContract.getOwnerNodes(ownerAddress);
  }

  /**
   * Verify that a wallet address owns a specific on-chain nodeId
   */
  async verifyNodeOwnership(nodeId: string, walletAddress: string): Promise<boolean> {
    if (!this.nodeRegistryContract) throw new Error('Contracts not initialized');
    try {
      const node = await this.nodeRegistryContract.getNode(nodeId);
      return node[0].toLowerCase() === walletAddress.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Initialize with private key for server-side signing
   */
  async initWithPrivateKey(privateKey: string, rpcUrl: string, network: 'sepolia' | 'localhost' = 'sepolia'): Promise<void> {
    this.network = network;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, this.provider);
    this.signer = wallet as any; // Wallet implements Signer interface
    this.address = wallet.address;
    this.connected = true;

    const addresses = CONTRACT_ADDRESSES[network];
    if (addresses.OTT) {
      this.ottContract = new Contract(addresses.OTT, OTT_ABI, wallet);
      this.nodeRegistryContract = new Contract(addresses.NodeRegistry, NODE_REGISTRY_ABI, wallet);
      this.taskEscrowContract = new Contract(addresses.TaskEscrow, TASK_ESCROW_ABI, wallet);
    }
  }

  // ============ Utility Functions ============

  formatOtt(amount: bigint): string {
    return ethers.formatEther(amount);
  }

  parseOtt(amount: string): bigint {
    return ethers.parseEther(amount);
  }

  /**
   * Generate a unique challenge string for node authentication
   */
  static generateChallenge(nodeId: string): string {
    const timestamp = Date.now();
    const nonce = Math.random().toString(36).substring(2);
    return `OtherThing Node Auth\nNode: ${nodeId}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
  }
}

// Singleton instance
export const web3Service = new Web3Service();
