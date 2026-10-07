import { escapeHtml } from "@/lib/utils";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FROM = () => process.env.EMAIL_FROM ?? "VSS Pulse <noreply@localhost>";

export type Email = { to: string; subject: string; html: string };

/** Email is best-effort: a provider outage must never fail the action that triggered it. */
export async function sendTransactionalEmail(input: Email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info("[email skipped: RESEND_API_KEY not set]", input.subject, "→", input.to);
    return { skipped: true as const };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [input.to], subject: input.subject, html: input.html }),
    });
    if (!res.ok) {
      console.error("[email] Resend rejected the message:", res.status, await res.text());
      return { skipped: false as const, ok: false as const };
    }
    return { skipped: false as const, ok: true as const };
  } catch (error) {
    console.error("[email] could not reach Resend:", error);
    return { skipped: false as const, ok: false as const };
  }
}

/** Resend's batch endpoint takes up to 100 messages per call. */
export async function sendEmailBatch(messages: Email[]) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email skipped: RESEND_API_KEY not set] ${messages.length} message(s)`);
    return { skipped: true as const, sent: 0 };
  }

  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map((m) => ({ from: FROM(), to: [m.to], subject: m.subject, html: m.html }))
        ),
      });
      if (res.ok) sent += chunk.length;
      else console.error("[email] Resend batch rejected:", res.status, await res.text());
    } catch (error) {
      console.error("[email] could not reach Resend:", error);
    }
  }
  return { skipped: false as const, sent };
}

function layout(heading: string, body: string, cta?: { label: string; path: string }) {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${APP_URL}${cta.path}" style="background:#0c7c6c;color:#fff;padding:10px 18px;border-radius:2px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#122033">
  <p style="font:600 11px ui-monospace,monospace;letter-spacing:.18em;color:#0c7c6c;margin:0 0 8px">VSS PULSE</p>
  <h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(heading)}</h2>
  ${body}${button}
  <p style="font-size:12px;color:#5c6774;margin-top:32px">You are receiving this because you have an account on VSS Pulse.</p>
</div>`;
}

export function welcomeEmail(name: string, email: string, password: string) {
  return {
    subject: "Your VSS Pulse account",
    html: layout(
      `Welcome, ${name}`,
      `<p>An account was created for you.</p>
<p>Email: <strong>${escapeHtml(email)}</strong><br/>Temporary password: <code style="background:#f3efe6;padding:2px 6px">${escapeHtml(password)}</code></p>
<p>You will be asked to choose a new password after your first sign-in.</p>`,
      { label: "Sign in", path: "/login" }
    ),
  };
}

export function taskAssignedEmail(name: string, title: string, taskId: string) {
  return {
    subject: `Assigned: ${title}`,
    html: layout(
      "You have a new task",
      `<p>Hi ${escapeHtml(name)},</p><p>You were assigned <strong>${escapeHtml(title)}</strong>.</p>`,
      { label: "Open task", path: `/tasks/${taskId}` }
    ),
  };
}

export function taskStatusEmail(name: string, title: string, status: string, by: string, taskId: string) {
  return {
    subject: `${title} is now ${status}`,
    html: layout(
      "Task status updated",
      `<p>Hi ${escapeHtml(name)},</p><p><strong>${escapeHtml(by)}</strong> moved <strong>${escapeHtml(title)}</strong> to <strong>${escapeHtml(status)}</strong>.</p>`,
      { label: "Open task", path: `/tasks/${taskId}` }
    ),
  };
}

export function announcementEmail(name: string, by: string, body: string) {
  return {
    subject: "Company announcement",
    html: layout(
      "Company announcement",
      `<p>Hi ${escapeHtml(name)},</p><p style="white-space:pre-wrap">${escapeHtml(body)}</p><p style="color:#5c6774">— ${escapeHtml(by)}</p>`,
      { label: "Open chat", path: "/chat?c=00000000-0000-0000-0000-000000000001" }
    ),
  };
}
