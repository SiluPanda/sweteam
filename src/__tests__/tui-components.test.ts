import { describe, it, expect } from 'vitest';
import React from 'react';
import { ChatMessageComponent, ChatList, type ChatMessage } from '../tui/chat-ui.js';
import { TaskRow, Dashboard, type DashboardTask } from '../tui/dashboard.js';
import { SessionRow, SessionListView, type SessionEntry } from '../tui/session-list.js';

describe('tui/chat-ui — ChatMessageComponent', () => {
  it('should create a React element', () => {
    const msg: ChatMessage = { role: 'user', content: 'Hello' };
    const el = React.createElement(ChatMessageComponent, { message: msg });
    expect(el).toBeTruthy();
    expect(el.type).toBe(ChatMessageComponent);
  });

  it('should pass message props', () => {
    const msg: ChatMessage = { role: 'agent', content: 'Response' };
    const el = React.createElement(ChatMessageComponent, { message: msg });
    expect(el.props.message.role).toBe('agent');
    expect(el.props.message.content).toBe('Response');
  });
});

describe('tui/chat-ui — ChatList', () => {
  it('should create a list element with messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Session started' },
      { role: 'user', content: 'Add feature' },
    ];
    const el = React.createElement(ChatList, { messages });
    expect(el).toBeTruthy();
    expect(el.props.messages.length).toBe(2);
  });
});

describe('tui/dashboard — TaskRow', () => {
  it('should create element for a task', () => {
    const task: DashboardTask = { id: 't-1', title: 'Config', status: 'done' };
    const el = React.createElement(TaskRow, { task });
    expect(el).toBeTruthy();
    expect(el.props.task.status).toBe('done');
  });
});

describe('tui/dashboard — Dashboard', () => {
  it('should create dashboard with tasks', () => {
    const tasks: DashboardTask[] = [
      { id: 't-1', title: 'A', status: 'done' },
      { id: 't-2', title: 'B', status: 'running' },
      { id: 't-3', title: 'C', status: 'queued' },
    ];
    const el = React.createElement(Dashboard, { tasks, sessionId: 's_test' });
    expect(el).toBeTruthy();
    expect(el.props.tasks.length).toBe(3);
  });
});

describe('tui/session-list — SessionRow', () => {
  it('should create element for a session', () => {
    const session: SessionEntry = {
      id: 's_abc',
      repo: 'owner/repo',
      goal: 'Add feature',
      status: 'building',
      prNumber: null,
    };
    const el = React.createElement(SessionRow, { session });
    expect(el).toBeTruthy();
  });
});

describe('tui/session-list — SessionListView', () => {
  it('should create list with sessions', () => {
    const sessions: SessionEntry[] = [
      { id: 's_1', repo: 'a/b', goal: 'G1', status: 'planning', prNumber: null },
      { id: 's_2', repo: 'c/d', goal: 'G2', status: 'stopped', prNumber: 5 },
    ];
    const el = React.createElement(SessionListView, { sessions });
    expect(el).toBeTruthy();
    expect(el.props.sessions.length).toBe(2);
  });

  it('should handle empty sessions', () => {
    const el = React.createElement(SessionListView, { sessions: [] });
    expect(el).toBeTruthy();
  });
});
