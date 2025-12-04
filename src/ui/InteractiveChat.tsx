/**
 * Ink-based interactive chat UI
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
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
      content: 'Welcome! Ask questions or share information about yourself. Type /help for commands.',
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    // Load initial stats
    setStats(memoryManager.getMemoryStats());
  }, [memoryManager]);

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing) return;

    const userInput = value.trim();
    setInput('');

    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: userInput, timestamp: new Date() }]);

    // Handle commands
    if (userInput.toLowerCase() === '/quit' || userInput.toLowerCase() === '/exit') {
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: '\nGoodbye! Final stats shown below.' },
      ]);
      const finalStats = memoryManager.getMemoryStats();
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Active: ${finalStats.activeMemories} | Archived: ${finalStats.archivedMemories} | Total: ${finalStats.totalMemories}`,
        },
      ]);
      setTimeout(() => exit(), 1000);
      return;
    }

    if (userInput.toLowerCase() === '/help' || userInput.toLowerCase() === '/commands') {
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Commands:
/help     - Show this help
/stats    - Memory statistics
/memories - Show all memories
/clear    - Clear all memories
/quit     - Exit`,
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
          content: `Memory Stats:
  Active: ${currentStats.activeMemories}
  Archived: ${currentStats.archivedMemories}
  Total: ${currentStats.totalMemories}
  Tokens: ${currentStats.activeContextTokens}
  Utilization: ${(currentStats.contextUtilization * 100).toFixed(1)}%`,
        },
      ]);
      return;
    }

    if (userInput.toLowerCase() === '/memories') {
      const activeMemories = memoryManager['store'].getActiveMemories();
      const archivedMemories = memoryManager['store'].getArchivedMemories();

      let memoryText = `\n=== ACTIVE MEMORIES (${activeMemories.length}) ===\n`;
      if (activeMemories.length > 0) {
        activeMemories.forEach((m, i) => {
          memoryText += `${i + 1}. [Score: ${m.importanceScore.toFixed(1)}] ${m.content}\n`;
        });
      } else {
        memoryText += 'None\n';
      }

      memoryText += `\n=== ARCHIVED MEMORIES (${archivedMemories.length}) ===\n`;
      if (archivedMemories.length > 0) {
        archivedMemories.forEach((m, i) => {
          memoryText += `${i + 1}. [Score: ${m.importanceScore.toFixed(1)}] ${m.content}\n`;
        });
      } else {
        memoryText += 'None\n';
      }

      setMessages((prev) => [...prev, { role: 'system', content: memoryText }]);
      return;
    }

    if (userInput.toLowerCase() === '/clear') {
      memoryManager['store'].clearAllMemories();
      setMessages((prev) => [...prev, { role: 'system', content: '✓ All memories cleared!' }]);
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

      // Add agent response
      setMessages((prev) => [
        ...prev,
        { role: 'agent', content: result.agentResponse, timestamp: new Date() },
      ]);

      // Check if memory was stored (look for console output)
      // Update stats
      setStats(memoryManager.getMemoryStats());
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `Error: ${error}. Please try again.` },
      ]);
    }

    setIsProcessing(false);
  };

  useInput((_input, key) => {
    if (key.escape) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} marginBottom={1}>
        <Box flexDirection="column">
          <Text bold color="cyan">
            🤖 LangGraph RAG Agent with Memory
          </Text>
          {stats && (
            <Text dimColor>
              Memories: {stats.activeMemories} active · {stats.archivedMemories} archived · {stats.activeContextTokens} tokens
            </Text>
          )}
        </Box>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" marginBottom={1} height={20} overflow="hidden">
        {messages.slice(-10).map((msg, idx) => (
          <Box key={idx} marginBottom={1}>
            {msg.role === 'user' && (
              <Text color="green" bold>
                You: <Text color="white">{msg.content}</Text>
              </Text>
            )}
            {msg.role === 'agent' && (
              <Text color="blue" bold>
                Agent: <Text color="white">{msg.content}</Text>
              </Text>
            )}
            {msg.role === 'system' && (
              <Text color="yellow" dimColor>
                {msg.content}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Input */}
      <Box borderStyle="round" borderColor="green" paddingX={1}>
        {isProcessing ? (
          <Text color="yellow">⏳ Processing...</Text>
        ) : (
          <Box>
            <Text color="green" bold>
              You:{' '}
            </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Type your message or /help for commands..."
            />
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>Press ESC to exit</Text>
      </Box>
    </Box>
  );
};
