/**
 * Ink-based interactive chat UI with fixed viewport and scrolling
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { MemoryManager, MemoryStats } from '../memory/memoryManager.js';
import { AgentStateType } from '../agent/state.js';

interface Message {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp?: Date;
}

interface InteractiveChatProps {
  agent: any;
  memoryManager: MemoryManager;
}

export const InteractiveChat: React.FC<InteractiveChatProps> = ({ agent, memoryManager }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'system',
      content: 'Welcome! Ask questions or share information. Type /help for commands.',
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Terminal dimensions with sensible defaults
  const terminalHeight = stdout?.rows ?? 24;
  const terminalWidth = stdout?.columns ?? 80;

  // Reserve space for header (3), input (3), footer (2), padding (2)
  const messageAreaHeight = Math.max(terminalHeight - 10, 5);

  useEffect(() => {
    setStats(memoryManager.getMemoryStats());
  }, [memoryManager]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    setScrollOffset(0);
  }, [messages.length]);

  // Convert all messages to rendered lines for line-by-line scrolling
  const allRenderedLines = useMemo(() => {
    const lines: Array<{ messageIdx: number; line: string; role: Message['role'] }> = [];

    messages.forEach((msg, idx) => {
      const roleConfig = {
        user: { prefix: 'You: ' },
        agent: { prefix: 'AI: ' },
        system: { prefix: '' },
      };

      const prefix = roleConfig[msg.role].prefix;
      const prefixWidth = prefix.length;
      const effectiveWidth = Math.max(terminalWidth - prefixWidth - 2, 20);

      const contentLines = msg.content.split('\n');
      let isFirstLine = true;

      contentLines.forEach((line) => {
        if (line.length === 0) {
          lines.push({ messageIdx: idx, line: '', role: msg.role });
          isFirstLine = false;
        } else {
          // Wrap long lines
          for (let i = 0; i < line.length; i += effectiveWidth) {
            const chunk = line.slice(i, i + effectiveWidth);
            const displayLine = isFirstLine ? `${prefix}${chunk}` : `${' '.repeat(prefixWidth)}${chunk}`;
            lines.push({ messageIdx: idx, line: displayLine, role: msg.role });
            isFirstLine = false;
          }
        }
      });

      // Add spacing line between messages
      lines.push({ messageIdx: idx, line: '', role: msg.role });
    });

    return lines;
  }, [messages, terminalWidth]);

  // Calculate total lines and visible slice
  const totalLines = allRenderedLines.length;
  const maxScrollOffset = Math.max(0, totalLines - messageAreaHeight);

  // Clamp scroll offset
  const clampedScrollOffset = Math.min(scrollOffset, maxScrollOffset);

  // Get visible lines (scroll from bottom)
  const startIdx = Math.max(0, totalLines - messageAreaHeight - clampedScrollOffset);
  const endIdx = totalLines - clampedScrollOffset;
  const visibleLines = allRenderedLines.slice(startIdx, endIdx);

  const canScrollUp = clampedScrollOffset < maxScrollOffset;
  const canScrollDown = clampedScrollOffset > 0;

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing) return;

    const userInput = value.trim();
    setInput('');

    setMessages((prev) => [...prev, { role: 'user', content: userInput, timestamp: new Date() }]);

    // Commands
    if (userInput.toLowerCase() === '/quit' || userInput.toLowerCase() === '/exit') {
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: 'Goodbye!' },
      ]);
      const finalStats = memoryManager.getMemoryStats();
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Final: ${finalStats.activeMemories} active | ${finalStats.archivedMemories} archived`,
        },
      ]);
      setTimeout(() => exit(), 1000);
      return;
    }

    if (userInput.toLowerCase() === '/help') {
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: '/help /stats /memories /clear /quit · ↑↓ to scroll',
        },
      ]);
      return;
    }

    if (userInput.toLowerCase() === '/stats') {
      const currentStats = memoryManager.getMemoryStats();
      setStats(currentStats);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Stats: ${currentStats.activeMemories} active, ${currentStats.archivedMemories} archived, ${currentStats.activeContextTokens} tokens, ${(currentStats.contextUtilization * 100).toFixed(1)}% util`,
        },
      ]);
      return;
    }

    if (userInput.toLowerCase() === '/memories') {
      const activeMemories = memoryManager['store'].getActiveMemories();
      const archivedMemories = memoryManager['store'].getArchivedMemories();

      const lines: string[] = [`Active (${activeMemories.length}):`];
      activeMemories.slice(0, 5).forEach((m, i) => {
        lines.push(`  ${i + 1}. [${m.importanceScore.toFixed(1)}] ${m.content.slice(0, 60)}...`);
      });
      if (activeMemories.length > 5) lines.push(`  ...and ${activeMemories.length - 5} more`);

      lines.push(`Archived (${archivedMemories.length}):`);
      archivedMemories.slice(0, 3).forEach((m, i) => {
        lines.push(`  ${i + 1}. [${m.importanceScore.toFixed(1)}] ${m.content.slice(0, 60)}...`);
      });
      if (archivedMemories.length > 3) lines.push(`  ...and ${archivedMemories.length - 3} more`);

      setMessages((prev) => [...prev, { role: 'system', content: lines.join('\n') }]);
      return;
    }

    if (userInput.toLowerCase() === '/clear') {
      memoryManager['store'].clearAllMemories();
      setMessages((prev) => [...prev, { role: 'system', content: '✓ Memories cleared' }]);
      setStats(memoryManager.getMemoryStats());
      return;
    }

    // Process with agent
    setIsProcessing(true);

    try {
      const initialState: Partial<AgentStateType> = {
        userQuery: userInput,
        processedQuery: '',
        activeMemories: [],
        recalledMemories: [],
        ragDocuments: [],
        agentResponse: '',
        memoryStats: {},
        iterationCount: 0,
      };

      const result = await agent.invoke(initialState);

      setMessages((prev) => [
        ...prev,
        { role: 'agent', content: result.agentResponse, timestamp: new Date() },
      ]);

      setStats(memoryManager.getMemoryStats());
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `Error: ${error}` },
      ]);
    }

    setIsProcessing(false);
  };

  useInput((input, key) => {
    if (key.escape) {
      exit();
    }
    // Scroll with arrow keys when not in input
    if (key.upArrow && canScrollUp) {
      setScrollOffset((prev) => prev + 1);
    }
    if (key.downArrow && canScrollDown) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
  });

  return (
    <Box flexDirection="column" height={terminalHeight - 1}>
      {/* Header - compact */}
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          RAG Agent
        </Text>
        {stats && (
          <Text dimColor>
            {stats.activeMemories}↑ {stats.archivedMemories}↓ {stats.activeContextTokens}tok
          </Text>
        )}
      </Box>

      {/* Scroll indicator */}
      <Box justifyContent="center" height={1}>
        {canScrollUp ? (<Text dimColor>↑ more messages ↑</Text>) : (<Text> </Text>)}
      </Box>

      {/* Messages - fixed height viewport */}
      <Box flexDirection="column" height={messageAreaHeight} overflow="hidden">
        {visibleLines.map((lineData, idx) => (
          <Box key={`${lineData.messageIdx}-${idx}`} flexShrink={0}>
            <LineRow line={lineData.line} role={lineData.role} />
          </Box>
        ))}
      </Box>

      {/* Scroll indicator */}
      <Box justifyContent="center" height={1}>
        {canScrollDown ? (<Text dimColor>↓ newer messages ↓</Text>) : (<Text> </Text>)}
      </Box>


      {/* Input */}
      <Box borderStyle="round" borderColor={isProcessing ? 'yellow' : 'green'} paddingX={1} height={3}>
        {isProcessing ? (
          <Box flexDirection="row" justifyContent="center" alignItems="center">
            <Text color="yellow">{'Thinking...'}</Text>
          </Box>
        ) : (
          <Box flexDirection="row">
            <Text color="green" bold>{'> '}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Message or /help"
            />
          </Box>
        )}
      </Box>
      {/* Footer - minimal */}
      <Box>
        <Text dimColor>ESC exit · ↑↓ scroll</Text>
      </Box>
    </Box>
  );
};

// Separate component to render individual lines with proper coloring
const LineRow: React.FC<{ line: string; role: Message['role'] }> = React.memo(({ line, role }) => {
  const roleConfig = {
    user: { color: 'green' as const },
    agent: { color: 'blue' as const },
    system: { color: 'yellow' as const },
  };

  const color = roleConfig[role].color;
  const dimColor = role === 'system';

  return <Text color={color} dimColor={dimColor}>{line}</Text>;
});

LineRow.displayName = 'LineRow';