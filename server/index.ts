import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3000);

const app = createApp();
app.listen(port, () => {
  console.log(`Express listening on http://localhost:${port}`);
});
