export type AlertSeverity = "info" | "warning" | "error";

interface AlertInput {
  severity: AlertSeverity;
  title: string;
  details?: Record<string, unknown>;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  error: "🔴",
};

export async function notifySlack(input: AlertInput): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return; // notifications are best-effort, never block the job

  const detailLines = input.details
    ? Object.entries(input.details)
        .map(([key, value]) => `• *${key}*: ${String(value)}`)
        .join("\n")
    : "";

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${SEVERITY_EMOJI[input.severity]} *${input.title}*${detailLines ? `\n${detailLines}` : ""}`,
      }),
    });
  } catch (err) {
    console.error("Failed to send Slack notification:", err);
  }
}

/** Only for `error` severity: avoids flooding an inbox with routine info alerts. */
export async function notifyEmail(input: AlertInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!apiKey || !to || !from || input.severity !== "error") return;

  const detailsHtml = input.details
    ? `<ul>${Object.entries(input.details)
        .map(([key, value]) => `<li><strong>${key}:</strong> ${String(value)}</li>`)
        .join("")}</ul>`
    : "";

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: `[Beatdagame Bot] ${input.title}`,
        html: `<p>${input.title}</p>${detailsHtml}`,
      }),
    });
  } catch (err) {
    console.error("Failed to send email notification:", err);
  }
}

export async function notify(input: AlertInput): Promise<void> {
  await Promise.allSettled([notifySlack(input), notifyEmail(input)]);
}
