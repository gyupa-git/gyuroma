import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startCounting } from "./engine/counter";
import "./styles.css";

startCounting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
