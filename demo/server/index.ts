// Demo backend (M2). Tiny on purpose: one login endpoint that follows the auth-login contract.
// Run: npm i express && npx tsx demo/server/index.ts

import express from "express";

const app = express();
app.use(express.json());

const users = new Map([["ada@example.com", { id: "42", password: "hunter2" }]]);

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.get(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  const token = `demo-${user.id}-${Date.now()}`;
  res.json({ userId: user.id, token });
});

app.listen(4000, () => console.log("demo api on http://localhost:4000"));
