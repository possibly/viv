import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

export interface SelectableListItem {
    key: string;
    label: string;
}

export interface SelectableListProps {
    items: SelectableListItem[];
    selectedKey: string | null;
    onSelect: (key: string) => void;
    focused: boolean;
    height?: number;
}

/**
 * A keyboard-navigable vertical list. Stateless w.r.t. selection (driven
 * by selectedKey from the parent); handles input when focused.
 *
 * Supports j/k and arrow keys; reports selection changes via onSelect.
 * Windowed to keep `height` rows visible with the selection in view.
 */
export function SelectableList({
    items,
    selectedKey,
    onSelect,
    focused,
    height = 20
}: SelectableListProps): React.ReactElement {
    const selectedIndex = Math.max(
        0,
        items.findIndex((i) => i.key === selectedKey)
    );
    const [scrollTop, setScrollTop] = useState(0);

    useEffect(() => {
        if (selectedIndex < scrollTop) setScrollTop(selectedIndex);
        else if (selectedIndex >= scrollTop + height) setScrollTop(selectedIndex - height + 1);
    }, [selectedIndex, scrollTop, height]);

    useInput(
        (input, key) => {
            if (!focused || items.length === 0) return;
            if (key.downArrow || input === "j") {
                const next = items[Math.min(items.length - 1, selectedIndex + 1)];
                if (next) onSelect(next.key);
            } else if (key.upArrow || input === "k") {
                const prev = items[Math.max(0, selectedIndex - 1)];
                if (prev) onSelect(prev.key);
            } else if (input === "g") {
                const first = items[0];
                if (first) onSelect(first.key);
            } else if (input === "G") {
                const last = items[items.length - 1];
                if (last) onSelect(last.key);
            }
        },
        { isActive: focused }
    );

    const visible = items.slice(scrollTop, scrollTop + height);

    if (items.length === 0) {
        return (
            <Box>
                <Text dimColor>(empty)</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            {visible.map((item, i) => {
                const absolute = scrollTop + i;
                const isSelected = absolute === selectedIndex;
                const colorProps = isSelected ? { color: "cyan" } : {};
                return (
                    <Text
                        key={item.key}
                        {...colorProps}
                        inverse={isSelected && focused}
                    >
                        {isSelected ? "> " : "  "}
                        {item.label}
                    </Text>
                );
            })}
        </Box>
    );
}
