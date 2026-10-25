import type { Metadata } from "next";
import { AppearancePicker } from "../../components/appearance-picker";
export const metadata: Metadata = { title: "Your data · theChair" };

export default function Privacy() {
  return <main className="site-document">
    <nav aria-label="Page navigation"><a href="/">theChair</a><AppearancePicker /></nav>
    <h1>Your data</h1>
    <p>Updated October 24, 2026.</p>
    <section><h2>What we store</h2><p>Your account details, workspace membership, messages, images, reactions, code agreements, and check results. Connected GitHub access tokens and shared secrets are stored for the server to use.</p></section>
    <section><h2>Who can see it</h2><p>Workspace screens and images require membership. Owners manage invites, access keys, and connections. The people operating this service can access its database for support and maintenance.</p></section>
    <section><h2>AI and hosting</h2><p>Team AI chat sends text to the configured AI provider. Code checks may send changed source files to Gemini. Images are shared with teammates and are not sent for AI analysis.</p><p>Supabase stores accounts and workspace data. Vercel runs the website. These services process data under their own policies.</p></section>
    <section><h2>Storage and removal</h2><p>Messages and shared images stay until removed by an operator. Unsent image drafts expire after 24 hours and are cleaned up as the service runs. Account and workspace deletion currently require a support request.</p></section>
    <section><h2>Browser storage and verification</h2><p>Your browser keeps your sign-in session, theme, and last-opened chat. Cloudflare Turnstile checks sign-in and account forms to limit automated abuse. The site does not load advertising trackers.</p></section>
    <section><h2>Get help</h2><p>For account help or data removal, email <a href="mailto:paragsahani60@gmail.com">paragsahani60@gmail.com</a>. Include your account email and workspace name. Do not send passwords or access keys.</p></section>
    <a href="/workspaces">Open workspace</a>
  </main>;
}
