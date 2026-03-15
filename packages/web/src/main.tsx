import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Web3Provider } from "./web3/Web3Provider";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Web3Provider>
      <App />
    </Web3Provider>
  </BrowserRouter>
);
