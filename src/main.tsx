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
  defaultRadius: "md",
  autoContrast: true,
  luminanceThreshold: 0.42,
  colors: {
    ink: [
      "#f7f9fc",
      "#edf2f7",
      "#e3e8ee",
      "#ccd5df",
      "#8a93a3",
      "#5b6472",
      "#3f4651",
      "#2b313b",
      "#1a1f28",
      "#0e1116",
    ],
    blue: [
      "#eef6ff",
      "#dcecff",
      "#b9d8ff",
      "#89bafd",
      "#5b9af6",
      "#2e7def",
      "#2469cb",
      "#1c55a6",
      "#163f7d",
      "#102b55",
    ],
    red: [
      "#fff4ef",
      "#ffe4d8",
      "#ffc7ad",
      "#ffa176",
      "#ff8b5a",
      "#ff7a3d",
      "#d75d28",
      "#ad451b",
      "#843314",
      "#58210d",
    ],
    orange: [
      "#fff4ef",
      "#ffe4d8",
      "#ffc7ad",
      "#ffa176",
      "#ff8b5a",
      "#ff7a3d",
      "#d75d28",
      "#ad451b",
      "#843314",
      "#58210d",
    ],
    yellow: [
      "#fff7ed",
      "#ffe9d5",
      "#ffd0aa",
      "#ffb174",
      "#ff964f",
      "#ff7a3d",
      "#d75d28",
      "#ad451b",
      "#843314",
      "#58210d",
    ],
    green: [
      "#ecfdf5",
      "#d2f9e7",
      "#a9f0d1",
      "#73e1b3",
      "#45d096",
      "#2bc48a",
      "#1fa372",
      "#18815b",
      "#126144",
      "#0c402e",
    ],
    gray: [
      "#ffffff",
      "#f7f9fc",
      "#edf2f7",
      "#e3e8ee",
      "#d4dce6",
      "#b8c2cf",
      "#8a93a3",
      "#5b6472",
      "#2b313b",
      "#0e1116",
    ],
    violet: [
      "#eef6ff",
      "#dcecff",
      "#b9d8ff",
      "#89bafd",
      "#5b9af6",
      "#2e7def",
      "#2469cb",
      "#1c55a6",
      "#163f7d",
      "#102b55",
    ],
  },
  fontFamily: "var(--font-sans)",
  fontFamilyMonospace: "var(--font-mono)",
  headings: {
    fontFamily: "var(--font-display)",
    fontWeight: "700",
  },
  radius: {
    xs: "8px",
    sm: "10px",
    md: "20px",
    lg: "28px",
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
