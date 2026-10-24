// Demo login screen (M2). Reads userId from the login response, per the auth-login contract.

import { useState } from "react";

export function Login() {
  const [email, setEmail] = useState("ada@example.com");
  const [password, setPassword] = useState("hunter2");
  const [greeting, setGreeting] = useState("");

  async function submit() {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    localStorage.setItem("token", data.token);
    setGreeting(`Welcome, user #${data.user_id}`);
  }

  return (
    <div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button onClick={submit}>Log in</button>
      <p>{greeting}</p>
    </div>
  );
}
