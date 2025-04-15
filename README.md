# 🎮 Prompt Clash

A real-time multiplayer web party game where players respond to quirky prompts, then vote for their favorite answers — built with **SvelteKit**, **Supabase**, and **AWS**.

![demo](./demo.gif) <!-- add a GIF or screenshot here -->

---

## 🚀 Live Demo

🌐 [Try it out at promptclash.xyz](https://promptclash.xyz)

---

## 🛠 Tech Stack

- **Frontend:** SvelteKit, TypeScript, Tailwind
- **Backend-as-a-Service:** Supabase (Auth, Realtime DB, Subscriptions)
- **Database:** PostgreSQL
- **Deployment:** AWS EC2, Caddy, Route53 DNS

---

## 🧩 Features

- 🔒 Real-time multiplayer room creation with Supabase subscriptions  
- ✍️ Prompt-based input and voting mechanics  
- 🎨 Responsive UI with dynamic state updates  
- 🔁 Session management with live game syncing  
- 🧠 Auth via Supabase + scoring logic  

---

## 📸 Screenshots

| Lobby                            | Voting Phase                     | Winner Reveal                  |
|----------------------------------|----------------------------------|--------------------------------|
| ![lobby](./screenshots/lobby.png) | ![voting](./screenshots/voting.png) | ![winner](./screenshots/winner.png) |

---

## 📦 Run Locally

```bash
git clone https://github.com/dpavide/promptclash.git
cd promptclash
npm install
npm run dev

## 🔑 Environment Variables

Create a `.env` file in the root directory with the following keys:

```env
PUBLIC_SUPABASE_URL=your_supabase_url
PUBLIC_SUPABASE_ANON_KEY=your_anon_key
