import { Box, Text } from "ink";
import React from "react";

export interface StatusBarProps {
    keys: { key: string; desc: string }[];
    right?: string;
}

/**
 * Bottom-of-screen keybinding hints + optional right-aligned status text.
 * Keeps hints short so they fit in narrow terminals.
 */
export function StatusBar({ keys, right }: StatusBarProps): React.ReactElement {
    return (
        <Box justifyContent="space-between">
            <Box>
                {keys.map((k, i) => (
                    <Text key={i}>
                        <Text color="cyan">{k.key}</Text>
                        <Text dimColor>{` ${k.desc}  `}</Text>
                    </Text>
                ))}
            </Box>
            {right !== undefined ? <Text dimColor>{right}</Text> : null}
        </Box>
    );
}
