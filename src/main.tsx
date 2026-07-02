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
  primaryColor: "violet",
  primaryShade: 5,
  defaultRadius: "md",
  autoContrast: true,
  luminanceThreshold: 0.42,
  colors: {
    ink: [
      "#fafafc",
      "#eee9fb",
      "#e3dcf6",
      "#d6cfe8",
      "#8f89a3",
      "#6b6680",
      "#4f4a62",
      "#2a2a3e",
      "#211f35",
      "#1a1a2e",
    ],
    blue: [
      "#f4f1ff",
      "#eee9fb",
      "#e3dcf6",
      "#c9bcfb",
      "#a897f3",
      "#8b72f0",
      "#6d4fe0",
      "#5537c8",
      "#4727b5",
      "#2a1574",
    ],
    red: [
      "#fff3ee",
      "#fbe9e5",
      "#f4cfc4",
      "#e8aa99",
      "#d78068",
      "#b54727",
      "#96391f",
      "#772d19",
      "#5c2112",
      "#3d160c",
    ],
    orange: [
      "#fff3ee",
      "#fbe9e5",
      "#f4cfc4",
      "#e8aa99",
      "#d78068",
      "#b54727",
      "#96391f",
      "#772d19",
      "#5c2112",
      "#3d160c",
    ],
    yellow: [
      "#fff8ed",
      "#f8edd7",
      "#edd8b1",
      "#dfbe82",
      "#c99e56",
      "#a97731",
      "#875c24",
      "#66451b",
      "#483012",
      "#2d1d0a",
    ],
    green: [
      "#eff9f3",
      "#ddeee3",
      "#bdddc9",
      "#94c5a8",
      "#68a982",
      "#1f7a4c",
      "#18643d",
      "#124d2f",
      "#0d3822",
      "#082516",
    ],
    gray: [
      "#fafafc",
      "#f4f1f8",
      "#eee9fb",
      "#e5e1ef",
      "#d6cfe8",
      "#b7afca",
      "#8f89a3",
      "#6b6680",
      "#2a2a3e",
      "#1a1a2e",
    ],
    violet: [
      "#faf8ff",
      "#eee9fb",
      "#e3dcf6",
      "#c9bcfb",
      "#a897f3",
      "#8b72f0",
      "#6d4fe0",
      "#5537c8",
      "#4727b5",
      "#2a1574",
    ],
  },
  fontFamily: "var(--font-sans)",
  fontFamilyMonospace: "var(--font-mono)",
  headings: {
    fontFamily: "var(--font-display)",
    fontWeight: "800",
  },
  radius: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "14px",
    xl: "999px",
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
