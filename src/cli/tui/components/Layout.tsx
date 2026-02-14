import React, { type ReactNode } from 'react';
import { Box } from 'ink';

interface LayoutProps {
  children: ReactNode;
  columns: number;
  rows: number;
}

export function Layout({ children, columns, rows }: LayoutProps) {
  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      borderStyle="round"
      borderColor="gray"
    >
      {children}
    </Box>
  );
}
