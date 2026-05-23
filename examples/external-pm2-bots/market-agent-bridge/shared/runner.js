async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runForever(roleName, runOnce) {
  const runForeverFlag = process.env.RUN_FOREVER !== "false";
  const intervalMs = Number(process.env.BOT_INTERVAL_MS || 900000);
  const startupDelayMs = Number(process.env.STARTUP_DELAY_MS || 0);

  if (!runForeverFlag) {
    await runOnce();
    return;
  }

  if (startupDelayMs > 0) {
    console.log(`[${roleName}] startup delay ${startupDelayMs}ms`);
    await sleep(startupDelayMs);
  }

  while (true) {
    const startedAt = new Date().toISOString();
    console.log(`[${roleName}] cycle started ${startedAt}`);

    try {
      await runOnce();
      console.log(`[${roleName}] cycle completed ${new Date().toISOString()}`);
    } catch (err) {
      console.error(`[${roleName}] cycle failed: ${err.message}`);
    }

    await sleep(intervalMs);
  }
}

module.exports = { sleep, runForever };
