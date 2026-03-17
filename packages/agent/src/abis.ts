// Contract ABIs — only the functions the house agent needs

export const RaffleFactoryAbi = [
  {
    name: "createRaffle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params_",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "ticketPriceUsd6", type: "uint256" },
          { name: "maxEntriesPerUser", type: "uint256" },
          { name: "numWinners", type: "uint256" },
          { name: "winnerShareBps", type: "uint256" },
          { name: "beneficiaryShareBps", type: "uint256" },
          { name: "beneficiaryOptions", type: "address[]" },
          { name: "duration", type: "uint256" },
          { name: "targetPoolSize", type: "uint256" },
          { name: "minUniqueParticipants", type: "uint256" },
          { name: "agentsOnly", type: "bool" },
        ],
      },
    ],
    outputs: [{ name: "vault", type: "address" }],
  },
  {
    name: "claimDeposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [],
  },
  {
    name: "getDeployedVaultsCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getDeployedVault",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "calculateDeposit",
    type: "function",
    stateMutability: "pure",
    inputs: [{ name: "targetPoolSize", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const RaffleVaultAbi = [
  {
    name: "state",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "closesAt",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalPool",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getParticipantCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getWinners",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "winningBeneficiary",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "creator",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "uniqueParticipantCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "enterRaffle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "beneficiaryVote", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "getAcceptedTokens",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "ticketPriceUsd6",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "closeRaffle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "requestDraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "distributePrizes",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "distributeRefunds",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // Events
  {
    name: "StateTransition",
    type: "event",
    inputs: [
      { name: "from", type: "uint8", indexed: false },
      { name: "to", type: "uint8", indexed: false },
    ],
  },
  {
    name: "WinnersSelected",
    type: "event",
    inputs: [
      { name: "winners", type: "address[]", indexed: false },
      { name: "winningBeneficiary", type: "address", indexed: false },
    ],
  },
] as const;

export const RaffleRegistryAbi = [
  {
    name: "getRaffleCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getActiveRaffles",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "getRaffle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "vault", type: "address" },
          { name: "creator", type: "address" },
          { name: "name", type: "string" },
          { name: "createdAt", type: "uint256" },
          { name: "closesAt", type: "uint256" },
          { name: "targetPoolSize", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getRafflesByCreator",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
] as const;

export const AgentRegistryAbi = [
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentURI", type: "string" },
      { name: "bondAmount", type: "uint256" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "hasActiveBond",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getAgentIdByAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isSuspended",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "totalAgents",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const MockVRFDispatcherAbi = [
  {
    name: "fulfillRequest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "nextRequestId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "RandomnessRequested",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "vault", type: "address", indexed: true },
    ],
  },
] as const;

export const ERC20Abi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
