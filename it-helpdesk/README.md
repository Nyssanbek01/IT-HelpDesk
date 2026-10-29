# IT HelpDesk

Базовый full-stack проект: React + TypeScript + Vite frontend и Express + TypeScript backend.

## Backend

```powershell
cd backend
npm install
npm run dev
```

API доступно на `http://localhost:3000`. Проверка состояния: `GET http://localhost:3000/api/health`.

## Frontend

В отдельном терминале:

```powershell
cd frontend
npm install
npm run dev
```

Откройте URL, показанный Vite (обычно `http://localhost:5173`). Запросы `/api` во время разработки проксируются на backend `http://localhost:3000`.
