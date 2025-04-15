# 🎮 Prompt Clash

A real-time multiplayer web party game where players respond to creative prompts and vote for the best responses — built with **SvelteKit**, **Supabase**, and **AWS**.

![Prompt Clash Demo](./demo.gif)

---

## 🌍 Live Demo

▶️ [promptclash.xyz](https://promptclash.xyz)

---

## 🧠 About

Built from scratch by a team of 6 as a Year 1 university project, Prompt Clash supports up to 8 players per game session, syncing live state across all users via Supabase's real-time subscriptions.

I led backend development, real-time syncing logic, and deployment on AWS.

---

## ⚙️ Tech Stack

| Layer       | Stack                                       |
|-------------|---------------------------------------------|
| Frontend    | SvelteKit, TypeScript, Tailwind             |
| Backend     | Supabase (Auth, DB, Realtime Subscriptions) |
| Database    | PostgreSQL                                  |
| Deployment  | AWS EC2, Caddy Reverse Proxy, Route53 DNS   |

---

## 🚀 Features

- 🔒 Authenticated multiplayer rooms (up to 8 players)
- ✍️ Custom prompt-based input & voting system
- 🔄 Real-time game state updates using Supabase Realtime
- ⚡ Live session management with auto-refresh
- 💻 Fully responsive UI

---

## 🖥 Run Locally

Clone the repo and start the dev server:

```bash
git clone https://github.com/dpavide/promptclash.git
cd promptclash
npm install
npm run dev
