use serde::Serialize;

// Open-weight models Ollama lists as built for tools and agentic coding, smallest first. Sizes are
// the download sizes Ollama's registry reported on 2026-09-29.
// ponytail: a fixed list goes stale; any other model can be typed in, and the list moves with
// app releases. Fetch it from the registry when it changes faster than we ship.
pub struct Entry {
    pub id: &'static str,
    pub label: &'static str,
    pub bytes: u64,
}

pub const CATALOG: [Entry; 8] = [
    Entry { id: "lfm2.5:8b", label: "LFM 2.5 8B", bytes: 5_156_075_045 },
    Entry { id: "ornith:9b", label: "Ornith 9B", bytes: 5_629_110_020 },
    Entry { id: "qwen3.5:9b", label: "Qwen 3.5 9B", bytes: 6_594_474_236 },
    Entry { id: "qwen3.8:27b", label: "Qwen 3.8 27B", bytes: 17_741_871_939 },
    Entry { id: "laguna-xs-2.1", label: "Laguna XS 2.1 33B", bytes: 20_274_302_663 },
    Entry { id: "ornith:35b", label: "Ornith 35B", bytes: 21_166_759_044 },
    Entry { id: "qwen3.6:35b", label: "Qwen 3.6 35B", bytes: 22_621_314_161 },
    Entry { id: "mistral-medium-3.5:128b", label: "Mistral Medium 3.5 128B", bytes: 80_241_474_657 },
];

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Fit {
    Good,
    Tight,
    TooBig,
    NoDisk,
}

// Apple silicon shares memory between the model and everything else, and a coding context (64k)
// adds its cache on top of the weights.
// ponytail: flat 20% for that cache, whatever the architecture; read layer and head counts from
// /api/show if the verdicts start to disagree with reality.
pub fn fit(bytes: u64, memory: u64, free_disk: u64) -> Fit {
    if bytes > free_disk {
        return Fit::NoDisk;
    }
    let needed = bytes as f64 * 1.2;
    let memory = memory as f64;
    if needed <= memory * 0.65 {
        Fit::Good
    } else if needed <= memory * 0.8 {
        Fit::Tight
    } else {
        Fit::TooBig
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1_000_000_000;
    const GIB: u64 = 1 << 30;

    fn verdicts(memory_gib: u64) -> Vec<Fit> {
        CATALOG.iter().map(|entry| fit(entry.bytes, memory_gib * GIB, 500 * GB)).collect()
    }

    #[test]
    fn a_16gb_mac_runs_the_9b_models_and_nothing_bigger() {
        let fits = verdicts(16);
        assert!(fits[..3].iter().all(|f| *f == Fit::Good), "{fits:?}");
        assert!(fits[3..].iter().all(|f| *f == Fit::TooBig), "{fits:?}");
    }

    #[test]
    fn more_memory_moves_bigger_models_into_reach() {
        assert_eq!(&verdicts(32)[3..5], [Fit::Good, Fit::Tight]);
        assert!(verdicts(64)[..7].iter().all(|f| *f == Fit::Good));
        assert_eq!(verdicts(128)[7], Fit::Tight);
    }

    #[test]
    fn a_model_bigger_than_the_free_disk_never_fits() {
        assert_eq!(fit(20 * GB, 128 * GIB, 10 * GB), Fit::NoDisk);
    }

    #[test]
    fn catalog_ids_are_unique_and_sorted_by_size() {
        assert!(CATALOG.windows(2).all(|pair| pair[0].bytes < pair[1].bytes && pair[0].id != pair[1].id));
    }
}
