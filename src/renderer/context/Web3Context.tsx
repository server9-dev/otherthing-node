import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ethers } from 'ethers';
import EthereumProvider from '@walletconnect/ethereum-provider';

// WalletConnect Project ID - get from cloud.walletconnect.com
const WALLETCONNECT_PROJECT_ID = 'e8c2c97bc93e37d1d5a4c6f48c0e75a7';

// Contract addresses - update after deployment
const CONTRACT_ADDRESSES: Record<string, { OTT: string; NodeRegistry: string; TaskEscrow: string }> = {
  sepolia: {
    OTT: '0x201333A5C882751a98E483f9B763DF4D8e5A1055',
    NodeRegistry: '0x4e420Eeaf3909b83aeF27A27677E02D88F89c0dC',
    TaskEscrow: '0x246127F9743AC938baB7fc221546a785C880ad86',
  },
  localhost: {
    OTT: '',
    NodeRegistry: '',
    TaskEscrow: '',
  },
};

// Minimal ABIs
const OTT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const NODE_REGISTRY_ABI = [
  'function minStake() view returns (uint256)',
  'function registerNode((uint32 cpuCores, uint32 memoryMb, uint32 gpuCount, uint32 gpuVramMb, bool hasOllama, bool hasSandbox) capabilities, string endpoint, uint256 stakeAmount) returns (bytes32)',
  'function getOwnerNodes(address owner) view returns (bytes32[])',
  'function getNode(bytes32 nodeId) view returns (tuple(address owner, uint256 stakedAmount, uint256 pendingRewards, uint256 totalEarned, uint256 totalComputeSeconds, uint256 reputation, uint256 registeredAt, uint256 lastActiveAt, bool isActive, bool isSlashed, tuple(uint32 cpuCores, uint32 memoryMb, uint32 gpuCount, uint32 gpuVramMb, bool hasOllama, bool hasSandbox) capabilities, string endpoint))',
  'function claimRewards(bytes32 nodeId)',
  'function addStake(bytes32 nodeId, uint256 amount)',
  'function withdrawStake(bytes32 nodeId, uint256 amount)',
  'function deactivateNode(bytes32 nodeId)',
  'function reactivateNode(bytes32 nodeId)',
  'event NodeRegistered(bytes32 indexed nodeId, address indexed owner, uint256 stake)',
];

// Types
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
  capabilities: {
    cpuCores: number;
    memoryMb: number;
    gpuCount: number;
    gpuVramMb: number;
    hasOllama: boolean;
    hasSandbox: boolean;
  };
  endpoint: string;
}

interface Web3ContextType {
  // Connection state
  connected: boolean;
  address: string | null;
  chainId: number | null;
  balance: string | null;
  ottBalance: string | null;

  // Contract state
  contractsReady: boolean;
  minStake: string | null;

  // On-chain nodes
  myNodes: OnChainNode[];
  loadingNodes: boolean;

  // WalletConnect state
  wcUri: string | null;
  showQRModal: boolean;
  setShowQRModal: (show: boolean) => void;

  // Actions
  connectWallet: () => Promise<void>;
  connectWithPrivateKey: (privateKey: string) => Promise<void>;
  disconnectWallet: () => void;
  refreshBalances: () => Promise<void>;
  refreshNodes: () => Promise<void>;

  // Contract interactions
  registerNode: (capabilities: {
    cpuCores: number;
    memoryMb: number;
    gpuCount: number;
    gpuVramMb: number;
    hasOllama: boolean;
    hasSandbox: boolean;
  }, endpoint: string, stakeAmount: string) => Promise<string>;
  claimRewards: (nodeId: string) => Promise<void>;
  addStake: (nodeId: string, amount: string) => Promise<void>;
  withdrawStake: (nodeId: string, amount: string) => Promise<void>;

  // Helpers
  formatOtt: (wei: bigint) => string;
  parseOtt: (amount: string) => bigint;

  // Errors
  error: string | null;
  clearError: () => void;

  // Connection state
  isConnecting: boolean;
}

const Web3Context = createContext<Web3ContextType | null>(null);

export function Web3Provider({ children }: { children: ReactNode }) {
  const [wcProvider, setWcProvider] = useState<EthereumProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [ottBalance, setOttBalance] = useState<string | null>(null);
  const [minStake, setMinStake] = useState<string | null>(null);
  const [myNodes, setMyNodes] = useState<OnChainNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);

  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [ottContract, setOttContract] = useState<ethers.Contract | null>(null);
  const [nodeRegistryContract, setNodeRegistryContract] = useState<ethers.Contract | null>(null);

  const getNetworkKey = (chainId: number): string => {
    if (chainId === 11155111) return 'sepolia';
    if (chainId === 31337) return 'localhost';
    return 'sepolia';
  };

  const contractsReady = !!ottContract && !!nodeRegistryContract &&
    CONTRACT_ADDRESSES[getNetworkKey(chainId || 0)]?.OTT !== '';

  // Format OTT from wei
  const formatOtt = (wei: bigint): string => {
    return ethers.formatEther(wei);
  };

  // Parse OTT to wei
  const parseOtt = (amount: string): bigint => {
    return ethers.parseEther(amount);
  };

  // Initialize contracts when connected
  const initializeContracts = useCallback(async (browserProvider: ethers.BrowserProvider, addr: string, chain: number) => {
    try {
      const jsonRpcSigner = await browserProvider.getSigner();

      setProvider(browserProvider);
      setSigner(jsonRpcSigner);

      // Initialize contracts
      const networkKey = getNetworkKey(chain);
      const addresses = CONTRACT_ADDRESSES[networkKey];

      if (addresses.OTT && addresses.NodeRegistry) {
        const ott = new ethers.Contract(addresses.OTT, OTT_ABI, jsonRpcSigner);
        const nodeRegistry = new ethers.Contract(addresses.NodeRegistry, NODE_REGISTRY_ABI, jsonRpcSigner);

        setOttContract(ott);
        setNodeRegistryContract(nodeRegistry);

        // Load min stake
        try {
          const stake = await nodeRegistry.minStake();
          setMinStake(formatOtt(stake));
        } catch (err) {
          console.error('Failed to load min stake:', err);
        }
      }

      // Get ETH balance
      const ethBalance = await browserProvider.getBalance(addr);
      setBalance(ethers.formatEther(ethBalance));

    } catch (err) {
      console.error('Failed to initialize contracts:', err);
      setError('Failed to initialize contracts');
    }
  }, []);

  // Connect wallet using WalletConnect
  const connectWallet = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // Create WalletConnect provider
      const ethereumProvider = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [11155111], // Sepolia
        optionalChains: [1], // Mainnet
        showQrModal: false, // We'll show our own
        metadata: {
          name: 'OtherThing Node',
          description: 'Distributed Compute Network Node',
          url: 'https://otherthing.io',
          icons: ['https://otherthing.io/logo.png'],
        },
      });

      // Listen for display_uri event to get QR code data
      ethereumProvider.on('display_uri', (uri: string) => {
        console.log('WalletConnect URI:', uri);
        setWcUri(uri);
        setShowQRModal(true);
      });

      // Listen for connection
      ethereumProvider.on('connect', async () => {
        console.log('WalletConnect connected');
        setShowQRModal(false);
        setWcUri(null);

        const accounts = await ethereumProvider.request({ method: 'eth_accounts' }) as string[];
        const chainIdHex = await ethereumProvider.request({ method: 'eth_chainId' }) as string;
        const chain = parseInt(chainIdHex, 16);

        if (accounts[0]) {
          setAddress(accounts[0]);
          setChainId(chain);
          setConnected(true);

          const browserProvider = new ethers.BrowserProvider(ethereumProvider);
          await initializeContracts(browserProvider, accounts[0], chain);
        }

        setIsConnecting(false);
      });

      // Listen for disconnect
      ethereumProvider.on('disconnect', () => {
        console.log('WalletConnect disconnected');
        resetState();
      });

      // Listen for account changes
      ethereumProvider.on('accountsChanged', (accounts: string[]) => {
        if (accounts[0]) {
          setAddress(accounts[0]);
        } else {
          resetState();
        }
      });

      // Listen for chain changes
      ethereumProvider.on('chainChanged', (chainIdHex: string) => {
        const chain = parseInt(chainIdHex, 16);
        setChainId(chain);
      });

      setWcProvider(ethereumProvider);

      // Enable the provider (triggers QR code display)
      await ethereumProvider.enable();

    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError(String(err));
      setIsConnecting(false);
      setShowQRModal(false);
      setWcUri(null);
    }
  };

  // Reset state on disconnect
  const resetState = () => {
    setConnected(false);
    setAddress(null);
    setChainId(null);
    setBalance(null);
    setOttBalance(null);
    setProvider(null);
    setSigner(null);
    setOttContract(null);
    setNodeRegistryContract(null);
    setMyNodes([]);
    setIsConnecting(false);
    setShowQRModal(false);
    setWcUri(null);
  };

  // Connect with private key (for desktop use)
  const connectWithPrivateKey = async (privateKey: string) => {
    setIsConnecting(true);
    setError(null);

    try {
      // Use reliable Sepolia RPC (public endpoints)
      const rpcProvider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');

      // Create wallet from private key
      const wallet = new ethers.Wallet(privateKey, rpcProvider);

      const addr = wallet.address;
      const network = await rpcProvider.getNetwork();
      const chain = Number(network.chainId);

      setAddress(addr);
      setChainId(chain);
      setConnected(true);

      // Set up contracts
      const networkKey = getNetworkKey(chain);
      const addresses = CONTRACT_ADDRESSES[networkKey];

      if (addresses.OTT && addresses.NodeRegistry) {
        const ott = new ethers.Contract(addresses.OTT, OTT_ABI, wallet);
        const nodeRegistry = new ethers.Contract(addresses.NodeRegistry, NODE_REGISTRY_ABI, wallet);

        setOttContract(ott);
        setNodeRegistryContract(nodeRegistry);

        try {
          const stake = await nodeRegistry.minStake();
          setMinStake(formatOtt(stake));
        } catch (err) {
          console.error('Failed to load min stake:', err);
        }

        // Get OTT balance
        try {
          const ottBal = await ott.balanceOf(addr);
          setOttBalance(formatOtt(ottBal));
        } catch (err) {
          console.error('Failed to load OTT balance:', err);
        }
      }

      // Get ETH balance
      const ethBalance = await rpcProvider.getBalance(addr);
      setBalance(ethers.formatEther(ethBalance));

      // Store provider reference (using any to avoid type issues with wallet as signer)
      setProvider(rpcProvider as any);
      setSigner(wallet as any);

      setIsConnecting(false);
    } catch (err) {
      console.error('Failed to connect with private key:', err);
      setError('Invalid private key');
      setIsConnecting(false);
      throw err;
    }
  };

  // Disconnect wallet
  const disconnectWallet = async () => {
    if (wcProvider) {
      try {
        await wcProvider.disconnect();
      } catch (err) {
        console.error('Failed to disconnect:', err);
      }
    }
    resetState();
  };

  // Refresh balances
  const refreshBalances = async () => {
    if (!provider || !address) return;

    try {
      const ethBalance = await provider.getBalance(address);
      setBalance(ethers.formatEther(ethBalance));

      if (ottContract) {
        const ott = await ottContract.balanceOf(address);
        setOttBalance(formatOtt(ott));
      }
    } catch (err) {
      console.error('Failed to refresh balances:', err);
    }
  };

  // Refresh on-chain nodes
  const refreshNodes = async () => {
    if (!nodeRegistryContract || !address) return;

    setLoadingNodes(true);
    try {
      const nodeIds = await nodeRegistryContract.getOwnerNodes(address);
      const nodes: OnChainNode[] = [];

      for (const nodeId of nodeIds) {
        const node = await nodeRegistryContract.getNode(nodeId);
        nodes.push({
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
        });
      }

      setMyNodes(nodes);
    } catch (err) {
      console.error('Failed to load nodes:', err);
    } finally {
      setLoadingNodes(false);
    }
  };

  // Register node on-chain
  const registerNode = async (
    capabilities: {
      cpuCores: number;
      memoryMb: number;
      gpuCount: number;
      gpuVramMb: number;
      hasOllama: boolean;
      hasSandbox: boolean;
    },
    endpoint: string,
    stakeAmount: string
  ): Promise<string> => {
    if (!nodeRegistryContract || !ottContract || !signer) {
      throw new Error('Contracts not initialized');
    }

    const networkKey = getNetworkKey(chainId || 0);
    const addresses = CONTRACT_ADDRESSES[networkKey];
    const stakeWei = parseOtt(stakeAmount);

    // Approve tokens
    const approveTx = await ottContract.approve(addresses.NodeRegistry, stakeWei);
    await approveTx.wait();

    // Register node
    const tx = await nodeRegistryContract.registerNode(
      [
        capabilities.cpuCores,
        capabilities.memoryMb,
        capabilities.gpuCount,
        capabilities.gpuVramMb,
        capabilities.hasOllama,
        capabilities.hasSandbox,
      ],
      endpoint,
      stakeWei
    );

    const receipt = await tx.wait();

    // Get nodeId from event
    for (const log of receipt.logs) {
      try {
        const parsed = nodeRegistryContract.interface.parseLog(log);
        if (parsed?.name === 'NodeRegistered') {
          const nodeId = parsed.args[0];
          await refreshNodes();
          await refreshBalances();
          return nodeId;
        }
      } catch {
        // Not our event
      }
    }

    throw new Error('NodeRegistered event not found');
  };

  // Claim rewards
  const claimRewards = async (nodeId: string): Promise<void> => {
    if (!nodeRegistryContract) throw new Error('Contract not initialized');
    const tx = await nodeRegistryContract.claimRewards(nodeId);
    await tx.wait();
    await refreshNodes();
    await refreshBalances();
  };

  // Add stake
  const addStake = async (nodeId: string, amount: string): Promise<void> => {
    if (!nodeRegistryContract || !ottContract) throw new Error('Contracts not initialized');

    const networkKey = getNetworkKey(chainId || 0);
    const addresses = CONTRACT_ADDRESSES[networkKey];
    const amountWei = parseOtt(amount);

    const approveTx = await ottContract.approve(addresses.NodeRegistry, amountWei);
    await approveTx.wait();

    const tx = await nodeRegistryContract.addStake(nodeId, amountWei);
    await tx.wait();
    await refreshNodes();
    await refreshBalances();
  };

  // Withdraw stake
  const withdrawStake = async (nodeId: string, amount: string): Promise<void> => {
    if (!nodeRegistryContract) throw new Error('Contract not initialized');
    const amountWei = parseOtt(amount);
    const tx = await nodeRegistryContract.withdrawStake(nodeId, amountWei);
    await tx.wait();
    await refreshNodes();
    await refreshBalances();
  };

  // Auto-refresh when connected
  useEffect(() => {
    if (connected && address) {
      refreshBalances();
      if (contractsReady) {
        refreshNodes();
      }
    }
  }, [connected, address, contractsReady]);

  // Try to set contract addresses from API on mount
  useEffect(() => {
    fetch('http://localhost:8080/api/v1/web3/contracts')
      .then(res => res.json())
      .then(data => {
        if (data.sepolia?.OTT) {
          CONTRACT_ADDRESSES.sepolia = data.sepolia;
        }
        if (data.localhost?.OTT) {
          CONTRACT_ADDRESSES.localhost = data.localhost;
        }
      })
      .catch(() => {
        // Ignore - contracts may not be deployed yet
      });
  }, []);

  const clearError = () => setError(null);

  return (
    <Web3Context.Provider value={{
      connected,
      address,
      chainId,
      balance,
      ottBalance,
      contractsReady,
      minStake,
      myNodes,
      loadingNodes,
      wcUri,
      showQRModal,
      setShowQRModal,
      connectWallet,
      connectWithPrivateKey,
      disconnectWallet,
      refreshBalances,
      refreshNodes,
      registerNode,
      claimRewards,
      addStake,
      withdrawStake,
      formatOtt,
      parseOtt,
      error,
      clearError,
      isConnecting,
    }}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error('useWeb3 must be used within a Web3Provider');
  }
  return context;
}
