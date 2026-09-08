import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "@/api/queryClient";
import App from "./App";
import Bootstrap from "./components/Bootstrap";
import "./index.css";

async function main(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("BurnGuard root element is missing.");
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Bootstrap><QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider></Bootstrap>
    </React.StrictMode>,
  );
}

void main();
