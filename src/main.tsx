import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dropzone/styles.css";
import "./i18n";
import App from "./App";
import "./index.css";

const theme = createTheme({
  primaryColor: "ink",
  primaryShade: 9,
  defaultRadius: "xl",
  autoContrast: true,
  luminanceThreshold: 0.42,
  colors: {
    ink: [
      "#f3f6fa",
      "#e3e8ee",
      "#cbd4df",
      "#aeb9c6",
      "#8a93a3",
      "#687080",
      "#4f5663",
      "#343a45",
      "#1a1f28",
      "#0e1116",
    ],
    blue: [
      "#eef5ff",
      "#dceaff",
      "#b9d5ff",
      "#8ab8fb",
      "#5b9af5",
      "#2e7def",
      "#1d66c8",
      "#174fa0",
      "#123d7a",
      "#0d2d59",
    ],
    red: [
      "#fff2eb",
      "#ffe1d3",
      "#ffc4a8",
      "#ffa075",
      "#ff884f",
      "#ff7a3d",
      "#d95d25",
      "#ad4519",
      "#833313",
      "#5c210c",
    ],
    orange: [
      "#fff2eb",
      "#ffe1d3",
      "#ffc4a8",
      "#ffa075",
      "#ff884f",
      "#ff7a3d",
      "#d95d25",
      "#ad4519",
      "#833313",
      "#5c210c",
    ],
    yellow: [
      "#fff8ed",
      "#ffecd2",
      "#ffd5a4",
      "#ffb971",
      "#ff9a4c",
      "#ff7a3d",
      "#d95d25",
      "#ad4519",
      "#833313",
      "#5c210c",
    ],
    green: [
      "#eafcf4",
      "#d1f7e6",
      "#a6eed0",
      "#78e1b8",
      "#4fd19f",
      "#2bc48a",
      "#1f9d6d",
      "#177852",
      "#10583c",
      "#0a3a28",
    ],
    gray: [
      "#ffffff",
      "#f3f6fa",
      "#eef2f6",
      "#e3e8ee",
      "#ccd6e1",
      "#aeb9c6",
      "#8a93a3",
      "#5b6472",
      "#343a45",
      "#0e1116",
    ],
    violet: [
      "#f3f6fa",
      "#e3e8ee",
      "#cbd4df",
      "#aeb9c6",
      "#8a93a3",
      "#687080",
      "#4f5663",
      "#343a45",
      "#1a1f28",
      "#0e1116",
    ],
  },
  fontFamily: "var(--font-sans)",
  fontFamilyMonospace: "var(--font-sans)",
  headings: {
    fontFamily: "var(--font-display)",
    fontWeight: "700",
  },
  radius: {
    xs: "6px",
    sm: "8px",
    md: "10px",
    lg: "14px",
    xl: "16px",
  },
  components: {
    Button: {
      defaultProps: {
        size: "sm",
        radius: "xl",
      },
    },
    ActionIcon: {
      defaultProps: {
        size: "sm",
        radius: "xl",
      },
    },
    TextInput: {
      defaultProps: {
        size: "sm",
        radius: "xl",
      },
    },
    Select: {
      defaultProps: {
        size: "sm",
        radius: "xl",
      },
    },
    Textarea: {
      defaultProps: {
        size: "sm",
        radius: "lg",
      },
    },
    Paper: {
      defaultProps: {
        radius: "lg",
      },
    },
    Badge: {
      defaultProps: {
        radius: "xl",
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <ModalsProvider>
        <Notifications position="top-right" />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>
);
