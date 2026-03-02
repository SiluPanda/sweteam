import React from "react";
import { Box, Text } from "ink";

export interface ChatMessage {
  role: "user" | "agent" | "system";
  content: string;
  createdAt?: Date | null;
}

interface ChatMessageProps {
  message: ChatMessage;
}

export function ChatMessageComponent({ message }: ChatMessageProps): React.ReactElement {
  const roleColors: Record<string, string> = {
    user: "green",
    agent: "cyan",
    system: "yellow",
  };

  const color = roleColors[message.role] ?? "white";
  const prefix = `[${message.role}]`;

  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color, bold: true }, prefix),
      React.createElement(Text, null, " "),
      React.createElement(Text, { wrap: "wrap" }, message.content),
    ),
  );
}

interface ChatListProps {
  messages: ChatMessage[];
}

export function ChatList({ messages }: ChatListProps): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },
    React.createElement(
      Text,
      { bold: true, underline: true },
      "Chat History",
    ),
    React.createElement(Box, { marginTop: 1 }),
    ...messages.map((msg, i) =>
      React.createElement(ChatMessageComponent, {
        key: i,
        message: msg,
      }),
    ),
  );
}
