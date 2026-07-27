const {createPublicClient, http, encodeFunctionData, parseAbi, keccak256, toBytes} = require("viem");
const client = createPublicClient({transport: http("https://rpc.testnet.arc.network"), chain: {id: 5042002}});
const PROXY = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const PROVIDER = "0xbcbf06e5e79d5dd61a6a606ad2d4d2bd034e8af2";
const IMPL = "0xa316fd02827242d537f84730f8a37d0ba5fd351a";
(async () => {
  const proxyCode = await client.getBytecode({address: PROXY});
  console.log("Proxy bytecode:", proxyCode);
  console.log("Proxy len bytes:", proxyCode.length / 2 - 1);
  
  // Try setBudget directly on implementation
  const cd = encodeFunctionData({
    abi: parseAbi(["function setBudget(uint256 jobId, uint256 amount, bytes optParams)"]),
    functionName: "setBudget",
    args: [126328n, 10000n, "0x"],
  });
  try {
    const r = await client.call({data: cd, to: IMPL, account: PROVIDER});
    console.log("Direct on impl:", r);
  } catch(e) {
    const rv = e.message?.match(/returnValue.*?0x([a-f0-9]+)/)?.[1];
    console.log("Direct impl revert:", rv ? "0x"+rv : "unknown");
  }
  
  // Check: maybe the proxy doesnt actually delegate calls correctly
