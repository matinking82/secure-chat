# SecureChat

SecureChat is a real-time chat application with end-to-end encrypted messaging support, file sharing, voice features, and built-in multiplayer games.

## Features

- Real-time messaging over Socket.IO
- End-to-end encryption support in the client workflow
- File sharing with upload support
- Message reactions, replies, and edit status
- Typing indicators and online presence signals
- Push notification support (VAPID)
- Voice chat support
- Built-in games inside chat conversations

## Built-in Games

SecureChat includes the following chat games:

1. Connect 4  
2. Chess  
3. XO (Tic-Tac-Toe)  
4. Minesweeper  
5. Othello  
6. Backgammon  
7. Hokm 2P  
8. Hokm 4P  
9. ChaarBarg  

## Screenshots
<!-- 
> You can replace or add more screenshots over time as the UI evolves. -->

### Welcome screen

![SecureChat Welcome Screen](https://github.com/user-attachments/assets/17fdba0e-cd98-4337-a324-c88436fab1e0)

## Tech Stack

### Backend
- Node.js + TypeScript
- Express
- Socket.IO
- Multer (file uploads)
- web-push (push notifications)

### Frontend
- React + TypeScript
- Vite
- Tailwind CSS
- Socket.IO Client

## Local Development

### 1) Install dependencies

```bash
npm install
cd client && npm install && cd ..
```

### 2) Configure environment

Create a `.env` file in the project root:

```env
PORT=4040
VAPID_SUBJECT=mailto:you@example.com
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
```

### 3) Start the app

Run backend and frontend in separate terminals:

```bash
# Terminal 1 (backend)
npm run dev:server
```

```bash
# Terminal 2 (frontend)
npm run dev:client
```

Then open the frontend URL shown by Vite (default: `http://localhost:5173`).

## Deployment

### Option A: Single host (recommended starting point)

1. Install dependencies:
   ```bash
   npm install
   cd client && npm install && cd ..
   ```
2. Build frontend:
   ```bash
   npm run build:client
   ```
3. Set environment variables (`PORT`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`).
4. Start server:
   ```bash
   npm run start
   ```

The Express server serves the built frontend from `client/dist` when available.

### Option B: Process manager (PM2 example)

```bash
npm install -g pm2
pm2 start "npm run start" --name securechat
pm2 save
```

## Notes

- Ensure the deployed domain supports WebSocket traffic for Socket.IO.
- If serving behind a reverse proxy (Nginx/Caddy), configure WebSocket upgrade headers.
- Keep VAPID keys private and rotate them when needed.
