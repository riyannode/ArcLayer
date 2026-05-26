export function getPayTo() { return process.env.X402_PAY_TO ?? process.env.X402_RECEIVER_ADDRESS ?? ""; }
