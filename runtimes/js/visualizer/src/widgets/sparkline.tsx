import { Text } from "ink";
import React from "react";

/** Eight vertical-fill Unicode blocks, from lowest to highest. */
const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export interface SparklineSample {
    /** 0..max-normalized height. */
    readonly value: number;
    /** If true, the sample is rendered dimmed to signal "forgotten" / muted state. */
    readonly muted?: boolean;
    /** Optional accent colour for a notable sample (e.g. peak, most recent). */
    readonly color?: string;
}

export interface SparklineProps {
    readonly samples: readonly (number | SparklineSample)[];
    /** Upper bound for the vertical scale. Defaults to 1 (salience scale). */
    readonly max?: number;
    /** Placeholder text when no samples are available. */
    readonly empty?: string;
    /** Colour for "normal" (non-muted, non-accented) samples. Defaults to cyan. */
    readonly color?: string;
}

/**
 * Fixed-height ASCII sparkline for a short numeric series. One character per
 * sample, so width == samples.length. Height is discretized into 8 steps via
 * vertical-fill Unicode blocks.
 */
export function Sparkline({
    samples,
    max = 1,
    empty = "(no samples)",
    color = "cyan"
}: SparklineProps): React.ReactElement {
    if (samples.length === 0) {
        return <Text dimColor>{empty}</Text>;
    }
    const upper = Math.max(max, 1e-9);
    return (
        <Text>
            {samples.map((raw, i) => {
                const sample: SparklineSample =
                    typeof raw === "number" ? { value: raw } : raw;
                const ratio = Math.max(0, Math.min(1, sample.value / upper));
                const idx = ratio === 0 ? 0 : Math.min(BARS.length - 1, Math.floor(ratio * BARS.length));
                const bar = BARS[idx]!;
                const fg = sample.color ?? color;
                if (sample.muted) {
                    return (
                        <Text key={i} dimColor>
                            {bar}
                        </Text>
                    );
                }
                return (
                    <Text key={i} color={fg}>
                        {bar}
                    </Text>
                );
            })}
        </Text>
    );
}
