/**
 * Sends a single test Slack message using the exact same format as the
 * real low-credit warning in publish.ts, but unconditionally (regardless
 * of the actual balance) and clearly labeled as a test. Useful for
 * confirming SLACK_WEBHOOK_URL is wired correctly without waiting for a
 * real publish run to hit the threshold.
 *
 * Usage: pnpm test-slack-credit-alert
 */
import "dotenv/config";
import { getCreditBalance, notify } from "@beatdagame/core";

async function main() {
  const balance = await getCreditBalance();

  await notify({
    severity: "warning",
    title: `[TESTE] kie.ai credits: ${balance} remaining`,
    details: { balance, threshold: 100 },
  });

  console.log(`Sent test Slack alert. Current kie.ai balance: ${balance}`);
}

main().catch((err) => {
  console.error("test-slack-credit-alert failed:", err);
  process.exitCode = 1;
});
