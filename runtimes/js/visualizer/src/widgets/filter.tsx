import { Box, Text, useInput } from "ink";
import React from "react";

export interface FilterInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    focused: boolean;
}

/**
 * A minimal single-line text input for filtering a pane's list. Active only
 * when `focused`; owns no state — the parent holds the string.
 */
export function FilterInput({
    value,
    onChange,
    onSubmit,
    onCancel,
    focused
}: FilterInputProps): React.ReactElement {
    useInput(
        (input, key) => {
            if (!focused) return;
            if (key.return) {
                onSubmit();
            } else if (key.escape) {
                onCancel();
            } else if (key.backspace || key.delete) {
                onChange(value.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                onChange(value + input);
            }
        },
        { isActive: focused }
    );
    return (
        <Box>
            <Text color="yellow">/</Text>
            <Text>{value}</Text>
            {focused ? <Text inverse> </Text> : null}
        </Box>
    );
}
