import { AppearancePicker } from "../components/appearance-picker";
import { BrandMark, FlowArt } from "../components/flow-art";
import "./landing.css";

function LandingIcon({ name }: { name: "arrow" | "chat" | "agreement" | "check" | "people" }) {
  const paths = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    chat: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" /><path d="M7 9h9m-9 4h6" /></>,
    agreement: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6m-6 4h6m-6 4h3" /></>,
    check: <><path d="M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Z" /><path d="m8 12 3 3 5-6" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></>,
  };
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export default function Home() {
  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">Skip to content</a>
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="theChair home">
          <BrandMark size={28} /><span>theChair<span className="landing-brand-dot">.</span></span>
        </a>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
        </nav>
        <div className="landing-header-actions">
          <AppearancePicker />
          <a className="landing-signin" href="/workspaces">Sign in<LandingIcon name="arrow" /></a>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <h1 id="landing-title">Catch code mismatches<br /><span>before merge.</span></h1>
            <p>Keep team chat and code agreements together. Check that what one teammate builds matches what another expects.</p>
            <div className="landing-hero-actions">
              <a className="landing-button landing-button-primary" href="/workspaces">Open workspace<LandingIcon name="arrow" /></a>
              <a className="landing-text-link" href="#example">See an example<span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <div className="landing-hero-visual" aria-hidden="true">
            <div className="landing-art-halo" />
            <FlowArt className="landing-bed" />
            <div className="landing-art-grid" />
          </div>
        </section>

        <section id="example" className="landing-example-section" aria-labelledby="example-title">
          <div className="landing-section-heading">
            <h2 id="example-title">See what gets caught.</h2>
            <p>The server sends <code>userId</code>.<br />The screen reads <code>user_id</code>.</p>
          </div>
          <figure className="landing-example">
            <div className="landing-example-header">
              <div className="landing-endpoint"><span>POST</span><code>/api/auth/login</code></div>
              <span className="landing-example-label">Example</span>
            </div>
            <div className="landing-example-grid">
              <div className="landing-agreement">
                <div className="landing-panel-title"><LandingIcon name="agreement" /><h3>Agreed fields</h3></div>
                <dl>
                  <div><dt>Request</dt><dd><code>email</code><code>password</code></dd></div>
                  <div><dt>Response</dt><dd><code className="landing-field-match">userId</code><code>token</code></dd></div>
                </dl>
              </div>
              <div className="landing-code-panel">
                <div className="landing-panel-title"><span className="landing-code-dot" aria-hidden="true" /><h3>Login screen</h3><span>Login.tsx</span></div>
                <pre aria-label="Example login code with a mismatched field"><code><span className="landing-code-muted">const</span> data = <span className="landing-code-muted">await</span> response.json();{"\n\n"}showUser(data.<mark>user_id</mark>);</code></pre>
                <div className="landing-issue"><span className="landing-issue-icon" aria-hidden="true">!</span><p>Field mismatch<span>Use <code>userId</code> instead of <code>user_id</code>.</span></p></div>
              </div>
            </div>
            <figcaption>theChair shows the mismatch and suggested change. Your team applies the fix.</figcaption>
          </figure>
        </section>

        <section id="how-it-works" className="landing-how" aria-labelledby="how-title">
          <div className="landing-section-heading"><h2 id="how-title">How it works.</h2><p>From a team decision to a code check.</p></div>
          <ol className="landing-steps">
            <li><span className="landing-step-number" aria-hidden="true">01</span><h3>Create a workspace</h3><p>Invite your team and start a chat.</p></li>
            <li><span className="landing-step-number" aria-hidden="true">02</span><h3>Agree on the details</h3><p>Save the fields your code will send and receive. An owner approves the agreement.</p></li>
            <li><span className="landing-step-number" aria-hidden="true">03</span><h3>Check the changes</h3><p>Connect GitHub and your AI tools. Review issues with the file, line, and suggested change.</p></li>
          </ol>
        </section>

        <section id="features" className="landing-features" aria-labelledby="features-title">
          <div className="landing-section-heading"><h2 id="features-title">What’s in your workspace.</h2></div>
          <div className="landing-feature-grid">
            <article><span className="landing-feature-icon"><LandingIcon name="chat" /></span><h3>Team chat</h3><p>Share messages and images. React to updates.</p></article>
            <article><span className="landing-feature-icon"><LandingIcon name="agreement" /></span><h3>Shared agreements</h3><p>Keep approved inputs and outputs in one place.</p></article>
            <article><span className="landing-feature-icon"><LandingIcon name="check" /></span><h3>Code checks</h3><p>Check planned edits and pushed code against your agreements.</p></article>
            <article><span className="landing-feature-icon"><LandingIcon name="people" /></span><h3>People and access</h3><p>Invite members by email. Choose who can approve agreements.</p></article>
          </div>
        </section>

        <section className="landing-start" aria-labelledby="start-title">
          <div><h2 id="start-title">Start with your team.</h2><p>Create a workspace or open one you’ve joined.</p></div>
          <a className="landing-button landing-button-primary" href="/workspaces">Open workspace<LandingIcon name="arrow" /></a>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/" aria-label="theChair home"><BrandMark size={23} /><span>theChair<span className="landing-brand-dot">.</span></span></a>
        <nav aria-label="Footer navigation"><a href="/privacy">Privacy</a><a href="/workspaces">Sign in</a></nav>
      </footer>
    </div>
  );
}
