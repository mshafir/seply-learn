"""Seed: a Claude chat that starts at "how do I track my token cost?" and ends
up deep in compute economics, transformer internals, training and new
architectures. The first sample that is a true learning chat."""
from common import G

g = G("compute", "AI compute & model internals",
      "From tracking Claude Code token cost to why capacity is scarce, why inference keeps getting cheaper, how transformers and MoE actually work, how models are trained, and what might replace the transformer.",
      {"kind": "claude-chat", "url": "https://claude.ai/share/d6409ff5-261c-400f-8ff0-9e4f3820314e", "dates": "2026-06 → 2026-06-17"})

g.rel_type("part-of", "is part of", "#7c3aed", dashed=True)
g.rel_type("prerequisite", "is needed to understand", "#2563eb")
g.rel_type("led-to", "led to", "#0f766e")
g.rel_type("modifies", "changes", "#9333ea", dashed=True)
g.rel_type("uses", "uses", "#ea580c")
g.rel_type("raises", "raises", "#dc2626")
g.rel_type("lowers", "lowers", "#16a34a")
g.rel_type("supports", "supports", "#4f46e5")
g.rel_type("challenges", "challenges", "#b45309", dashed=True)
g.rel_type("corrects", "corrects", "#a16207")
g.rel_type("reported-by", "is reported by", "#64748b", dashed=True)

# Models
g.attr("developer", "Developer")
g.attr("total", "Total params", "number", "B")
g.attr("active", "Active params", "number", "B")
g.attr("experts", "Routed experts", "number")
g.attr("active-experts", "Active experts")
g.attr("shared-expert", "Shared expert", "bool")
g.attr("attention", "Attention")
g.attr("layers", "Layers", "number")
g.attr("context", "Context")
g.attr("notes", "Notable")
# Techniques
g.attr("area", "Area", "enum", values=["attention", "position", "MoE", "serving", "training", "architecture"])
g.attr("stage", "Maturity", "enum", values=["research", "small-scale", "shipped", "standard"])
g.attr("effect", "Buys", "enum", values=["efficiency", "both", "quality"])
g.attr("applies", "Applied", "enum", values=["serving", "post-training", "architecture"])
g.attr("bottleneck", "Bottleneck attacked")
# Evidence
g.attr("independence", "Source", "enum", values=["independent", "academic", "analyst", "interested", "self-reported"])
g.attr("consensus", "Consensus", "enum", values=["settled", "emerging", "contested"])
# Misconceptions
g.attr("held-by", "Held by", "enum", values=["you", "Claude", "common"])
# Rates
g.attr("quantity", "Quantity")
g.attr("low", "Low", "number", "×/yr")
g.attr("high", "High", "number", "×/yr")
g.attr("direction", "Direction", "enum", values=["rise", "fall"])
g.attr("method", "Method")

R = g.r
def P(child, parent): R(child, parent, "part-of")

# ================================ Topics ======================================
for i, (id, title, summary) in enumerate([
    ("t-econ", "Compute economics", "Why capacity is scarce, how fast demand grows, and when it might ease"),
    ("t-cost", "Why inference gets cheaper", "What the famous cost-decline numbers measure, and what drives them"),
    ("t-inside", "Inside a transformer", "Tokens, attention, heads, layers, the KV-cache and position"),
    ("t-moe", "Mixture of Experts", "How sparse experts decouple capacity from cost, and where the idea came from"),
    ("t-models", "Open model landscape", "What the published open models are made of"),
    ("t-train", "Training", "Pre-training, post-training, RL and fine-tuning"),
    ("t-data", "Data", "What goes into training corpora and how they're refined"),
    ("t-beyond", "Beyond the transformer", "Hybrids, state-space models, byte-level, diffusion and concept models"),
    ("t-sources", "Sources", "Who the numbers come from, and how independent they are"),
]):
    g.c(id, title, "idea", ["topic"], summary, weight="aux", seq=i)

# ============================ Compute economics ===============================
g.c("fable-gating", "Fable 5 gated behind usage credits", "event", ["market"],
    "Pulled from subscription plans June 23 and billed at API rates ($10/$50 per M tokens); return is capacity-gated",
    date="2026-06-23", lane="market")
g.c("capacity", "Capacity constraint", "idea", ["economics"],
    "Not one knob: accelerators, HBM, power and electrical gear bind in turn",
    """
    Anthropic doesn't say what "capacity-driven" means internally. Industry-wide, the
    binding constraint has **moved**: power (2024–early 2025), then chips (late 2025 –
    early 2026), then long-lead electrical gear (from ~May 2026).
    """, weight="core")
for id, title, summary in [
    ("gpu-supply", "Accelerator supply (GPUs/TPUs)", "Blackwell sold out; Nvidia data-center revenue a record $51.2B in a quarter"),
    ("hbm-supply", "HBM memory supply", "SK Hynix sold out for 2026; memory ~30% of hyperscaler AI spend, up from ~8%"),
    ("power", "Power & grid", "Operators have held chips they couldn't energize; interconnection queues slip projects"),
    ("electrical-gear", "Transformers & switchgear", "High-voltage transformer lead times stretched from 12–18 to 36–48 months"),
]:
    g.c(id, title, "idea", ["economics", "constraint"], summary)
    P(id, "capacity")
g.c("compute-supply", "Available AI compute", "idea", ["economics"], "What can actually be energized and served")
g.c("compute-demand", "Compute demand", "idea", ["economics"], "Grew ~1,000,000× in two years by Nvidia's framing: ~10,000× per request × ~100× usage", weight="core")
g.c("reasoning-load", "Reasoning & agentic workloads", "idea", ["economics", "lever"],
    "Compute per inference session up ~10,000× as chatbots became reasoning agents")
g.c("usage-growth", "Usage growth", "idea", ["economics"], "~100× more usage in two years")
g.c("frontier-price", "Frontier inference price & scarcity", "idea", ["economics"],
    "Premium capacity gets priced up or rationed — Fable's $10/$50 is one instance", weight="core")
g.c("cost-per-token", "Serving cost per token", "idea", ["economics", "cost"], "What it costs a provider to produce a token at a given capability")
g.c("capex", "Hyperscaler capex", "thing", ["economics", "lever"], "Over $600B in 2026 (+36%), ~$450B of it AI infrastructure")
g.c("slip", "Construction & interconnection delays", "risk", ["economics"], "30–50% of planned 2026 AI capacity projected to slip to 2028")
g.c("jevons", "Jevons' paradox", "idea", ["economics"],
    "Cheaper tokens mean more tokens: efficiency gains get consumed by capability and usage, not passed through as price cuts")
g.c("inference-shift", "Inference overtakes training", "event", ["market", "forecast"],
    "Expected in 2027; by 2030 AI could be half of all data-center workloads", date="2027", lane="market")
g.c("capacity-relief", "Delayed capacity comes online", "event", ["market", "forecast"],
    "The likely window for easing the premium squeeze — if demand growth also slows", date="2027", dateEnd="2028", dateApprox=True, lane="market")
g.c("dc-growth", "Data centers: ~70 GW → ~220 GW", "event", ["market", "forecast"],
    "McKinsey: global supply could triple within five years, ~75% of growth from AI", date="2026", dateEnd="2031", dateApprox=True, lane="market")
g.c("nuclear", "New nuclear power at scale", "event", ["market", "forecast"],
    "Most projected US nuclear growth lands after 2035, as small modular reactors mature", date="2035", dateApprox=True, lane="market")
g.c("blackwell", "Blackwell sold out", "event", ["market"], "Nvidia FQ3 2026: record $51.2B data-center revenue, cloud GPUs sold out", date="2025-11", dateApprox=True, lane="market")
g.c("fable-release", "Claude Fable 5 released", "event", ["market"], "Anthropic's most powerful model, priced at double Opus", date="2026-06", lane="market")
for id in ["fable-gating", "capacity", "compute-supply", "compute-demand", "reasoning-load", "usage-growth", "frontier-price",
           "capex", "slip", "jevons", "inference-shift", "capacity-relief", "dc-growth", "nuclear", "blackwell", "fable-release"]:
    P(id, "t-econ")
g.outline_order("fable-release", "fable-gating", "capacity", "compute-demand", "reasoning-load", "usage-growth", "compute-supply", "capex",
                "slip", "frontier-price", "jevons", "blackwell", "inference-shift", "capacity-relief", "dc-growth", "nuclear")
g.outline_order("gpu-supply", "hbm-supply", "power", "electrical-gear")

# ========================== Why inference gets cheaper ========================
g.c("fixed-capability", "Cost at a fixed capability", "idea", ["cost"],
    "The Epoch metric: the cheapest model that clears a benchmark bar, not a frozen model getting cheaper",
    """
    The fixed thing is the **capability** (a benchmark score), not the model. The model that
    clears a bar in 2026 is smaller and cheaper than the one that cleared it in 2025. A
    frozen set of weights gets cheaper too, but through serving work and hardware, in
    lumps, and far more slowly.
    """, weight="core")
g.c("price-vs-cost", "Price ≠ serving cost", "idea", ["cost"],
    "List prices hold flat through a model's life and step down when a successor launches")
g.c("serving-opts", "Serving optimizations", "idea", ["cost", "lever"],
    "Batching, quantization, speculative decoding, attention kernels, KV-cache work — frozen weights, cheaper tokens")
g.c("hardware-gens", "Hardware generations", "thing", ["cost", "lever"],
    "More memory bandwidth and HBM per chip: the same model costs less per token on Blackwell")
g.c("distillation", "Distillation", "idea", ["cost", "training", "technique", "lever"],
    "Train a smaller student on a stronger model's outputs; the artifact is swapped, the capability kept",
    date="2015", lane="ideas",
    attributes={"area": "training", "stage": "standard", "effect": "both", "applies": "post-training",
                "bottleneck": "cost of reaching a capability"})
g.c("memory-bound", "Inference is memory-bound", "idea", ["cost", "inside"],
    "The bottleneck is moving data between HBM and on-chip SRAM, not arithmetic", weight="core")
g.c("algorithmic-progress", "Algorithmic efficiency", "idea", ["cost"],
    "A smooth ~3×/year from many small wins, punctuated by occasional new ideas")
g.c("rates", "Measured rates", "idea", ["cost"], "Growth and decline rates quoted in the chat, with their methods")
for id in ["fixed-capability", "cost-per-token", "price-vs-cost", "serving-opts", "hardware-gens", "distillation", "memory-bound", "algorithmic-progress", "rates"]:
    P(id, "t-cost")
g.outline_order("fixed-capability", "rates", "algorithmic-progress", "serving-opts", "hardware-gens", "distillation", "memory-bound", "price-vs-cost")

# ============================ Inside a transformer ============================
g.c("transformer", "A decoder-only transformer", "idea", ["inside", "component"],
    "The architecture every current frontier LLM is built on (shape shown: DeepSeek-V3)",
    date="2017-06", lane="ideas", weight="core",
    attributes={"area": "architecture", "stage": "standard"})
P("transformer", "t-inside")
components = [
    ("tokenizer", "Tokenizer", "transformer", "Chops text into tokens (vocab 129,280 in DeepSeek-V3)"),
    ("embedding", "Embedding", "transformer", "Turns each token into a 7,168-wide vector"),
    ("layer-stack", "Layer stack × 61", "transformer", "3 dense + 58 MoE layers, each refining the same vector; only the last predicts"),
    ("attention", "Attention", "layer-stack", "The only place tokens exchange information"),
    ("heads", "Heads (Q · K · V)", "attention", "128 heads per layer, each its own query/key/value lookup"),
    ("kv-cache", "KV-cache", "attention", "Past keys and values kept per layer; the biggest memory consumer in inference"),
    ("position", "Positional encoding", "attention", "Attention is order-blind; position has to be injected"),
    ("attn-kernel", "Attention kernel", "attention", "How the attention math is actually executed on the GPU"),
    ("ffn", "Feed-forward network", "layer-stack", "Processes each token alone; where much stored knowledge lives"),
    ("router", "Router (gate)", "ffn", "A small linear layer scoring every expert for every token"),
    ("experts", "Routed experts × 256", "ffn", "8 chosen per token per layer; each 7168 → 2048 → 7168"),
    ("shared-expert-c", "Shared expert", "ffn", "Always on, handles common processing"),
    ("residual", "Residual stream", "layer-stack", "Each layer adds an adjustment rather than replacing the vector"),
    ("output-head", "Output head (unembedding)", "transformer", "Projects the final vector to next-token probabilities"),
    ("serving", "Serving system", "transformer", "What runs the model for many users at once"),
    ("batching", "Batching", "serving", "Keeping accelerators saturated with many requests"),
    ("weights-precision", "Numeric precision", "serving", "FP8 / INT8 / INT4 instead of 16-bit"),
    ("decoding", "Decoding loop", "serving", "Generating one token at a time, autoregressively"),
]
for id, title, parent, summary in components:
    g.c(id, title, "idea", ["inside", "component"], summary)
    P(id, parent)
g.outline_order("tokenizer", "embedding", "layer-stack", "output-head", "serving")
g.outline_order("attention", "ffn", "residual")
g.outline_order("heads", "kv-cache", "position", "attn-kernel")
g.outline_order("router", "experts", "shared-expert-c")
g.c("qkv", "Query, key, value", "idea", ["inside"],
    "Query = what I'm looking for, key = what I advertise, value = what I hand over", )
P("qkv", "heads")
g.c("pretraining", "Pre-training", "idea", ["training"], "Next-token prediction over trillions of tokens: the expensive phase", weight="core")

techniques = [
    # id, title, summary, parent-topic, modifies, date, area, stage, effect, applies, bottleneck
    ("mha", "Multi-head attention", "Many parallel Q/K/V heads per layer, each learning a different relationship",
     "t-inside", "heads", "2017-06", "attention", "standard", None, None, None),
    ("mqa", "Multi-Query Attention (MQA)", "All query heads share one K/V head: cache shrinks ~N×, quality can dent",
     "t-inside", "heads", "2019", "attention", "shipped", "efficiency", "architecture", "KV-cache size"),
    ("gqa", "Grouped-Query Attention (GQA)", "Query heads in groups, one K/V head per group: most of MQA's savings, little loss",
     "t-inside", "heads", "2023", "attention", "standard", "efficiency", "architecture", "KV-cache size"),
    ("mla", "Multi-head Latent Attention (MLA)", "Cache a compressed 512-dim latent instead of full K/V (~32× smaller)",
     "t-inside", "kv-cache", "2024-05", "attention", "shipped", "efficiency", "architecture", "KV-cache size"),
    ("dsa", "DeepSeek Sparse Attention (DSA)", "A light indexer picks the most relevant past tokens; attend only to those",
     "t-inside", "attention", "2025-09", "attention", "shipped", "efficiency", "architecture", "long-context attention cost"),
    ("flash-attn", "FlashAttention", "Tile attention into SRAM and fuse it into one pass: identical output, far less memory traffic",
     "t-inside", "attn-kernel", "2022", "serving", "standard", "efficiency", "serving", "HBM ↔ SRAM traffic"),
    ("paged-attn", "PagedAttention", "KV-cache in OS-style pages: no wasted reservations, cheap prefix sharing (vLLM)",
     "t-inside", "kv-cache", "2023", "serving", "standard", "efficiency", "serving", "KV-cache fragmentation"),
    ("kv-quant", "KV-cache quantization", "Store keys and values in 8-bit or lower; keys are more sensitive than values",
     "t-inside", "kv-cache", None, "serving", "shipped", "efficiency", "serving", "KV-cache precision"),
    ("prefix-cache", "Prefix / prompt caching", "Compute a shared prefix's KV-cache once and reuse it — the source of cached-input discounts",
     "t-inside", "kv-cache", None, "serving", "standard", "efficiency", "serving", "redundant recomputation"),
    ("quantization", "Weight quantization", "Run weights at FP8/INT8/INT4, often with negligible quality loss",
     "t-cost", "weights-precision", None, "serving", "standard", "efficiency", "serving", "memory and bandwidth"),
    ("spec-decoding", "Speculative decoding", "A small draft model proposes tokens; the big model verifies them in parallel",
     "t-cost", "decoding", None, "serving", "standard", "efficiency", "serving", "one-token-at-a-time latency"),
    ("cont-batching", "Continuous batching", "Swap requests in and out mid-flight to keep accelerators saturated",
     "t-cost", "batching", None, "serving", "standard", "efficiency", "serving", "idle accelerators"),
    ("rope", "RoPE", "Rotate Q/K pairs by position; dot products then depend on relative distance",
     "t-inside", "position", "2021", "position", "standard", "quality", "architecture", None),
    ("pi", "Position Interpolation", "Squeeze positions back into the trained range; blurs local precision",
     "t-inside", "position", "2023", "position", "shipped", "efficiency", "post-training", "context length"),
    ("yarn", "YaRN", "Frequency-aware interpolation: keep fast (local) rotations, squeeze slow (long-range) ones",
     "t-inside", "position", "2023", "position", "shipped", "efficiency", "post-training", "context length"),
    ("nope", "NoPE", "No positional encoding at all in some layers; the causal mask carries order",
     "t-inside", "position", "2022", "position", "shipped", "efficiency", "architecture", "long-context extrapolation"),
    ("mtp", "Multi-Token Prediction", "Predict several future tokens in a causal chain; extra heads double as a speculative decoder",
     "t-inside", "output-head", None, "training", "shipped", "both", "architecture", "training signal / decode speed"),
    ("layer-sharing", "Cross-layer parameter sharing", "Reuse one layer's weights across the stack (ALBERT): saves memory, not compute",
     "t-inside", "layer-stack", "2019", "architecture", "small-scale", "efficiency", "architecture", "parameter memory"),
    ("kv-sharing", "Cross-layer KV-cache sharing", "Adjacent layers share one K/V cache",
     "t-inside", "kv-cache", "2024", "attention", "research", "efficiency", "architecture", "KV-cache size"),
    ("layer-pruning", "Layer pruning", "Many middle/late layers do little; prune or merge them with modest loss",
     "t-inside", "layer-stack", None, "architecture", "research", "efficiency", "post-training", "redundant depth"),
    ("linear-attn", "Linear / hybrid attention", "Full attention in only some layers (Kimi Linear: 1 in 4), cheap linear attention elsewhere",
     "t-beyond", "attention", "2025", "attention", "shipped", "efficiency", "architecture", "quadratic attention"),
    # MoE
    ("moe", "Mixture of Experts", "Split the FFN into many experts; a router sends each token to a few. Capacity of the total, cost of the active",
     "t-moe", "ffn", None, "MoE", "standard", "both", "architecture", "cost per parameter"),
    ("moe-1991", "Adaptive Mixtures of Local Experts", "Jacobs, Hinton, Jordan & Nowlan: the original idea",
     "t-moe", None, "1991", "MoE", "research", None, None, None),
    ("sparse-moe", "Sparsely-gated MoE layer", "Shazeer et al.: sparse gating in deep nets, up to 137B parameters",
     "t-moe", "ffn", "2017-01", "MoE", "research", "both", "architecture", "cost per parameter"),
    ("gshard", "GShard", "MoE folded into the Transformer, past 600B parameters",
     "t-moe", "ffn", "2020", "MoE", "small-scale", "both", "architecture", "cost per parameter"),
    ("switch", "Switch Transformer", "Simplified routing to one expert per token; toward trillion-parameter models",
     "t-moe", "router", "2021", "MoE", "small-scale", "both", "architecture", "routing cost"),
    ("lb-loss", "Auxiliary load-balancing loss", "Penalize lopsided routing so experts don't collapse into a few favourites",
     "t-moe", "router", "2017-01", "MoE", "standard", "efficiency", "architecture", "expert collapse"),
    ("aux-free", "Auxiliary-loss-free balancing", "Per-expert bias terms balance load without the loss's quality penalty (DeepSeek)",
     "t-moe", "router", "2024-12", "MoE", "shipped", "quality", "architecture", "expert collapse"),
    ("fine-grained", "Fine-grained + shared experts", "Many small experts plus an always-on shared one (DeepSeek)",
     "t-moe", "experts", "2024", "MoE", "shipped", "both", "architecture", "routing granularity"),
    ("no-shared", "Dropping the shared expert", "Qwen3 removed it — an unsettled MoE design question",
     "t-moe", "shared-expert-c", "2025-04", "MoE", "shipped", "efficiency", "architecture", None),
    # Training
    ("sft", "Supervised fine-tuning (SFT)", "Keep predicting tokens, but on curated examples of the behaviour you want",
     "t-train", None, None, "training", "standard", "quality", "post-training", None),
    ("reward-model", "Reward modeling", "Learn from comparisons which response is better",
     "t-train", None, None, "training", "standard", "quality", "post-training", None),
    ("rlhf", "RLHF", "Optimize against a learned reward model of human preference",
     "t-train", None, "2022", "training", "standard", "quality", "post-training", None),
    ("dpo", "DPO", "Optimize directly on preference pairs, no separate reward model",
     "t-train", None, "2023", "training", "standard", "quality", "post-training", None),
    ("rlvr", "RLVR", "Reinforcement learning from verifiable rewards: a checker, not a learned judge",
     "t-train", None, "2025-01", "training", "standard", "quality", "post-training", "reward hacking"),
    ("grpo", "GRPO", "Score a group of attempts and reinforce the above-average ones; no critic model",
     "t-train", None, "2024-02", "training", "standard", "quality", "post-training", "RL cost"),
    ("grpo-variants", "GRPO variants (DAPO, Dr. GRPO, VAPO…)", "Fixes for length bias, exploration collapse and instability",
     "t-train", None, "2025", "training", "shipped", "quality", "post-training", "RL failure modes"),
    ("lora", "LoRA", "Freeze the model, train tiny low-rank adapters: cheap, modular, no forgetting",
     "t-train", None, "2021", "training", "standard", "efficiency", "post-training", "fine-tuning cost"),
    ("qlora", "QLoRA", "LoRA over a 4-bit quantized base: fine-tune large models on one GPU",
     "t-train", None, "2023", "training", "standard", "efficiency", "post-training", "fine-tuning memory"),
    ("merging", "Specialize, then merge", "Train specialist models and weight-average them into one",
     "t-train", None, None, "training", "shipped", "quality", "post-training", "task interference"),
    ("chinchilla", "Chinchilla scaling", "For a fixed compute budget, train smaller models on more data (~20 tokens per parameter)",
     "t-train", None, "2022", "training", "standard", "both", "architecture", "compute allocation"),
    # Beyond
    ("ssm", "State-space models", "Replace attention with a fixed-size recurrent state: linear cost, lossy memory",
     "t-beyond", "attention", "2021", "architecture", "small-scale", "efficiency", "architecture", "quadratic attention"),
    ("mamba", "Mamba", "Selective state-space layers in one repeated block; matched Transformer++ up to ~1.3B",
     "t-beyond", "attention", "2023-12", "architecture", "small-scale", "efficiency", "architecture", "quadratic attention"),
    ("hybrids", "Mamba–Transformer hybrids", "Mostly Mamba layers with a few attention layers kept for recall",
     "t-beyond", "layer-stack", "2024-03", "architecture", "shipped", "efficiency", "architecture", "throughput"),
    ("blt", "Byte Latent Transformer", "No tokenizer: bytes grouped into dynamic patches; on par with Llama 3 from 1B to 8B",
     "t-beyond", "tokenizer", "2024-12", "architecture", "small-scale", "both", "architecture", "tokenization"),
    ("diffusion-lm", "Diffusion language models", "Generate a whole block in parallel by iterative denoising; 5–10× faster",
     "t-beyond", "decoding", "2025-02", "architecture", "shipped", "efficiency", "architecture", "sequential decoding"),
    ("block-diffusion", "Block diffusion", "Diffuse ~32-token blocks left to right: the production standard for dLLMs",
     "t-beyond", "decoding", "2025", "architecture", "shipped", "efficiency", "architecture", "variable-length output"),
    ("lcm", "Large Concept Model", "Reason and generate in a semantic concept space instead of tokens",
     "t-beyond", "output-head", "2024-12", "architecture", "research", "quality", "architecture", None),
    ("latent-reasoning", "Latent / recurrent-depth reasoning", "Think in hidden state rather than emitted chain-of-thought tokens",
     "t-beyond", "layer-stack", None, "architecture", "research", "quality", "architecture", None),
]
for id, title, summary, topic, mod, date, area, stage, effect, applies, bottleneck in techniques:
    attrs = {k: v for k, v in [("area", area), ("stage", stage), ("effect", effect), ("applies", applies), ("bottleneck", bottleneck)] if v}
    g.c(id, title, "idea", ["technique"], summary, date=date, lane="ideas" if date else None, attributes=attrs)
    P(id, topic)
    if mod: R(id, mod, "modifies")
g.patch("sparse-moe", tags=["technique", "breakthrough"])
g.patch("moe", tags=["technique", "lever"])
g.outline_order("transformer", "qkv", "memory-bound", "mha", "mqa", "gqa", "mla", "dsa", "flash-attn", "paged-attn", "kv-quant", "prefix-cache",
                "rope", "pi", "yarn", "nope", "mtp", "layer-sharing", "kv-sharing", "layer-pruning")
g.outline_order("moe", "moe-1991", "sparse-moe", "gshard", "switch", "lb-loss", "aux-free", "fine-grained", "no-shared")
P("pretraining", "t-train")
g.c("post-training", "Post-training", "idea", ["training"], "Everything after pre-training that turns a base model into an assistant: cheap, but where behaviour is shaped", weight="core")
P("post-training", "t-train")
for id in ["sft", "reward-model", "rlhf", "dpo", "rlvr", "grpo", "grpo-variants"]:
    g.d["relationships"] = [r for r in g.d["relationships"] if not (r["from"] == id and r["type"] == "part-of")]
    P(id, "post-training")
g.outline_order("chinchilla", "pretraining", "post-training", "lora", "qlora", "merging")
g.outline_order("sft", "reward-model", "rlhf", "dpo", "rlvr", "grpo", "grpo-variants")

# ============================ Data ==============================================
for i, (id, title, summary) in enumerate([
    ("web-crawl", "Filtered web crawl", "The backbone of every open pretraining corpus (Common Crawl → C4, FineWeb, DCLM…)"),
    ("extraction", "Extraction & cleaning", "Pull clean text out of HTML; most raw crawl is junk"),
    ("dedup", "Deduplication", "At document, paragraph and fuzzy levels"),
    ("quality-filter", "Model-based quality filtering", "Classifiers keep the best few percent — the real leverage"),
    ("decontamination", "Decontamination", "Remove benchmark leakage from training data"),
    ("synthetic-sft", "Synthetic SFT responses", "Tülu 3's new SFT responses were written by GPT-4o or Claude 3.5 Sonnet"),
    ("llm-judge", "LLM-as-a-judge preferences", "Preference pairs increasingly labelled by a model, not a human"),
    ("verifiable-problems", "Verifiable problems", "Math and code with checkable answers: small data, high leverage for RLVR"),
]):
    g.c(id, title, "idea", ["data"], summary, seq=i)
    P(id, "t-data")

# ============================ Models ===========================================
models = [
    # id, title, developer, date, total, active, experts, active_experts, shared, attention, layers, context, notes, topic
    ("gpt-1", "GPT-1", "OpenAI", "2018", 0.117, None, None, None, None, None, None, None, "The start of the dense scaling era", "t-models"),
    ("gpt-3", "GPT-3", "OpenAI", "2020", 175, None, None, None, None, None, None, None, "1000× GPT-1 in two years", "t-models"),
    ("gpt-4", "GPT-4", "OpenAI", "2023-03", 1800, None, None, None, None, None, None, None, "~1.8T estimated; the peak before sizes reversed", "t-models"),
    ("deepseek-v3", "DeepSeek-V3", "DeepSeek", "2024-12", 671, 37, 256, "8 + 1 shared", True, "MLA", 61, "160K (YaRN ×40)",
     "3 dense + 58 MoE layers, hidden 7168, FP8 native, MTP", "t-models"),
    ("deepseek-r1", "DeepSeek-R1", "DeepSeek", "2025-01", 671, 37, 256, "8 + 1 shared", True, "MLA", 61, None,
     "RLVR elicited reasoning, including an 'aha moment'", "t-models"),
    ("deepseek-v32", "DeepSeek-V3.2", "DeepSeek", "2025", 671, 37, 256, "8 + 1 shared", True, "MLA + DSA", 61, None,
     "Only architectural change: sparse attention; capability came from scaled RL", "t-models"),
    ("llama4", "Llama 4 Maverick", "Meta", "2025-04", 400, 17, 128, "2 (8192 wide)", None, "GQA", None, "1M",
     "Fewer, larger experts; MoE every other layer; ~22T tokens", "t-models"),
    ("llama4-scout", "Llama 4 Scout", "Meta", "2025-04", 109, None, None, None, None, "GQA", None, "10M", "The small sibling with a huge context", "t-models"),
    ("qwen3", "Qwen3", "Alibaba", "2025-04", None, None, None, None, False, "GQA", None, None, "Dropped the shared expert", "t-models"),
    ("kimi-k2", "Kimi K2", "Moonshot AI", "2025-07", 1000, 32, 384, None, True, "MLA", None, None, "The sparsest: 1T total, 32B active", "t-models"),
    ("kimi-linear", "Kimi Linear", "Moonshot AI", "2025", 48, None, None, None, None, "Delta + MLA (1 in 4)", None, None, "Linear attention in 3 of 4 layers, no positional encoding", "t-models"),
    ("glm-45", "GLM-4.5", "Zhipu", "2025-07", 355, 32, None, None, True, None, None, None, None, "t-models"),
    ("glm-5", "GLM-5", "Zhipu", "2026", 744, 40, 256, None, None, "DSA", 80, None,
     "Imports DSA; 80 layers to cut expert-parallel traffic; 'slime' async RL; trained on Huawei Ascend", "t-models"),
    ("glm-51", "GLM-5.1", "Zhipu", "2026-03", 744, 40, 256, "8", None, "DSA", None, None, "Claims 94.6% of Claude Opus 4.6's coding score (self-reported)", "t-models"),
    ("glm-52", "GLM-5.2", "Zhipu", "2026-06-13", 753, None, None, None, None, None, None, "1M", "High/Max reasoning presets; benchmark claims disputed", "t-models"),
    ("smollm3", "SmolLM3", "Hugging Face", "2025", None, None, None, None, None, "GQA + periodic NoPE", None, None, None, "t-models"),
    ("jamba", "Jamba", "AI21", "2024-03", 398, None, None, None, None, "Mamba + attention", None, None, "Largest Mamba hybrid family", "t-beyond"),
    ("nemotron-h", "Nemotron-H", "NVIDIA", "2025", None, None, None, None, None, "Mamba + few attention", None, None, "Swapped most attention for Mamba for throughput", "t-beyond"),
    ("granite-4", "Granite 4.0", "IBM", "2025", None, None, None, None, None, "Mamba + attention", None, None, "H-Small beat open models 12× its size on IFEval", "t-beyond"),
    ("mercury", "Mercury Coder", "Inception Labs", "2025-02", None, None, None, None, None, "Diffusion", None, None, "First commercial dLLM: ~1,100 tokens/s on H100", "t-beyond"),
    ("gemini-diffusion", "Gemini Diffusion", "Google", "2025-05", None, None, None, None, None, "Diffusion", None, None, "~1,479 tokens/s, coding parity with 2.0 Flash Lite", "t-beyond"),
]
for id, title, dev, date, total, active, experts, aexp, shared, attn, layers, ctx, notes, topic in models:
    attrs = {k: v for k, v in [("developer", dev), ("total", total), ("active", active), ("experts", experts), ("active-experts", aexp),
                               ("shared-expert", shared), ("attention", attn), ("layers", layers), ("context", ctx), ("notes", notes)] if v is not None}
    g.c(id, title, "thing", ["model"] + (["open-model"] if topic == "t-models" and not id.startswith("gpt") else []) + (["hybrid"] if topic == "t-beyond" else []),
        notes, date=date, lane="models", attributes=attrs)
    P(id, topic)
g.outline_order(*[m[0] for m in models])

# Which models use which techniques (Comparison Table columns, Maturity evidence)
for m, ts in {
    "deepseek-v3": ["mla", "fine-grained", "aux-free", "mtp", "yarn", "moe", "quantization"],
    "deepseek-r1": ["rlvr", "grpo", "mla", "moe"],
    "deepseek-v32": ["dsa", "mla", "moe", "fine-grained"],
    "llama4": ["gqa", "moe"], "llama4-scout": ["gqa", "moe"],
    "qwen3": ["gqa", "moe", "no-shared"],
    "kimi-k2": ["mla", "moe", "fine-grained"],
    "kimi-linear": ["linear-attn", "mla", "nope"],
    "glm-5": ["dsa", "moe"], "glm-51": ["dsa", "moe"],
    "smollm3": ["gqa", "nope"],
    "jamba": ["hybrids", "mamba", "moe"], "nemotron-h": ["hybrids", "mamba"], "granite-4": ["hybrids", "mamba"],
    "mercury": ["diffusion-lm"], "gemini-diffusion": ["diffusion-lm"],
}.items():
    for t in ts:
        R(m, t, "uses")

# ============================ Lineage (led to) ==================================
for a, b, note in [
    ("mha", "mqa", "one shared K/V head"), ("mqa", "gqa", "a middle ground"), ("mha", "mla", "compress K/V instead of sharing"),
    ("mla", "dsa", "sparse attention on top"),
    ("rope", "pi", "squeeze positions"), ("pi", "yarn", "frequency-aware squeeze"), ("rope", "nope", "drop it entirely"),
    ("moe-1991", "sparse-moe", "sparse gating in deep nets"), ("sparse-moe", "gshard", "into the Transformer"),
    ("gshard", "switch", "top-1 routing"), ("sparse-moe", "lb-loss", "fix expert collapse"), ("lb-loss", "aux-free", "without the loss penalty"),
    ("switch", "fine-grained", "many small experts + shared"), ("fine-grained", "no-shared", "Qwen3 drops it"),
    ("transformer", "mha", None), ("sparse-moe", "moe", None),
    ("rlhf", "rlvr", "a checker instead of a learned judge"), ("rlhf", "dpo", "skip the reward model"),
    ("grpo", "grpo-variants", "patching failure modes"), ("grpo", "rlvr", "made RLVR affordable"),
    ("lora", "qlora", "quantized base"),
    ("ssm", "mamba", "selective state"), ("mamba", "hybrids", "keep a little attention"), ("transformer", "hybrids", None),
    ("diffusion-lm", "block-diffusion", "blocks, left to right"), ("linear-attn", "hybrids", None),
    ("layer-sharing", "kv-sharing", "share the cache, not the weights"),
]:
    R(a, b, "led-to", note)

# ============================ Learning path (prerequisites) =====================
for a, b in [
    ("tokenizer", "embedding"), ("embedding", "attention"), ("attention", "qkv"), ("qkv", "heads"), ("heads", "mha"),
    ("attention", "kv-cache"), ("kv-cache", "mqa"), ("mha", "mqa"), ("mqa", "gqa"), ("gqa", "mla"), ("kv-cache", "mla"),
    ("mla", "dsa"), ("memory-bound", "flash-attn"), ("attn-kernel", "flash-attn"), ("kv-cache", "paged-attn"), ("kv-cache", "kv-quant"),
    ("kv-cache", "prefix-cache"), ("attention", "position"), ("position", "rope"), ("rope", "pi"), ("pi", "yarn"), ("rope", "nope"),
    ("attention", "layer-stack"), ("ffn", "layer-stack"), ("layer-stack", "residual"), ("layer-stack", "output-head"),
    ("ffn", "moe"), ("moe", "router"), ("moe", "experts"), ("router", "lb-loss"), ("lb-loss", "aux-free"), ("experts", "fine-grained"),
    ("shared-expert-c", "fine-grained"), ("hbm-supply", "memory-bound"), ("memory-bound", "kv-cache"),
    ("pretraining", "post-training"), ("post-training", "sft"), ("sft", "reward-model"), ("reward-model", "rlhf"),
    ("rlhf", "rlvr"), ("rlvr", "grpo"), ("grpo", "grpo-variants"), ("sft", "distillation"), ("post-training", "lora"), ("lora", "qlora"),
    ("attention", "ssm"), ("ssm", "mamba"), ("mamba", "hybrids"), ("layer-stack", "hybrids"), ("decoding", "diffusion-lm"),
    ("output-head", "mtp"), ("decoding", "spec-decoding"), ("fixed-capability", "algorithmic-progress"), ("moe", "fixed-capability"),
]:
    R(a, b, "prerequisite")

# ============================ Cause & effect ===================================
for a, b, t, note in [
    ("reasoning-load", "compute-demand", "raises", "~10,000× per request"), ("usage-growth", "compute-demand", "raises", "~100×"),
    ("compute-demand", "frontier-price", "raises", "3.4×/yr demand vs multi-year lead times"),
    ("compute-supply", "frontier-price", "lowers", None),
    ("gpu-supply", "compute-supply", "raises", None), ("hbm-supply", "compute-supply", "raises", None),
    ("power", "compute-supply", "raises", None), ("electrical-gear", "compute-supply", "raises", "the newest chokepoint"),
    ("slip", "compute-supply", "lowers", "30–50% of 2026 capacity slips to 2028"),
    ("capex", "gpu-supply", "raises", "$600B in 2026"), ("capex", "power", "raises", None),
    ("cost-per-token", "frontier-price", "raises", None),
    ("serving-opts", "cost-per-token", "lowers", "frozen weights"), ("hardware-gens", "cost-per-token", "lowers", "more bandwidth per chip"),
    ("moe", "cost-per-token", "lowers", "active params set the cost"), ("distillation", "cost-per-token", "lowers", "swap in a smaller model"),
    ("hbm-supply", "cost-per-token", "lowers", "inference is memory-bound"),
    ("cost-per-token", "usage-growth", "lowers", "Jevons: cheaper tokens, more tokens"),
    ("reasoning-load", "cost-per-token", "raises", "more tokens per answer"),
]:
    R(a, b, t, note)

# ============================ Sources ==========================================
sources = [
    ("epoch", "Epoch AI", "person", "independent", "Trend data from disclosures and prices; the most neutral source in the chat"),
    ("price-paper", "Inference price-trend paper (arXiv 2511.23455)", "source", "academic", "Controls for frozen list prices and competition"),
    ("open-price", "Open-model price analysis (LessWrong)", "source", "academic", "Open weights avoid proprietary list-price games"),
    ("nvidia", "Nvidia / Jensen Huang", "person", "interested", "Sells the chips: '$1 trillion in demand… we are going to be short'"),
    ("semianalysis", "SemiAnalysis", "person", "analyst", "Memory share of spend; chips as the binding constraint"),
    ("mckinsey", "McKinsey", "person", "analyst", "~70 → ~220 GW of data-center supply in five years"),
    ("jll", "JLL", "person", "interested", "Real-estate outlook: inference overtakes training in 2027"),
    ("accuris", "Accuris / Tech Insider", "source", "analyst", "Slips, cancellations, transformer lead times"),
    ("stanford-toy", "Stanford teaching model", "source", "academic", "Supply/demand scenarios — explicitly a toy, not a forecast"),
    ("rlvr-study", "RLVR coverage study", "source", "academic", "RL raises the odds of correct samples but narrows what's solvable"),
    ("tulu3", "Tülu 3 (Ai2)", "source", "independent", "The rare fully open post-training recipe"),
    ("dclm", "DCLM benchmark", "source", "academic", "Fixed model, only the data curation varies"),
    ("vl-study", "Vision-language specialist study", "source", "academic", "Specialists beat the all-task model on 5 of 7 tasks"),
    ("robustness-paper", "Hybrid robustness paper (2026)", "source", "academic", "Mamba components carry a new robustness weakness"),
    ("no-free-lunch", "'No Free Lunch' dLLM survey (2026)", "source", "academic", "Diffusion speedups vs autoregressive, compared carefully"),
    ("vendor-claims", "Vendor announcements", "source", "self-reported", "Benchmarks published by the model's own developer"),
    ("glm52-early", "GLM-5.2 launch coverage (June 13–15)", "source", "analyst", "No official benchmark numbers at release"),
    ("glm52-late", "GLM-5.2 later coverage (June 16–17)", "source", "self-reported", "Suddenly claims wins over GPT-5.5, sourcing unclear"),
]
for id, title, kind, ind, summary in sources:
    g.c(id, title, kind, ["source"], summary, attributes={"independence": ind})
    P(id, "t-sources")

# ============================ Claims (Evidence) =================================
claims = [
    ("c-100x", "Inference cost at fixed capability falls ~100×/year", "contested", "t-cost"),
    ("c-frontier-fastest", "Price declines are fastest at the capability frontier", "emerging", "t-cost"),
    ("c-squeeze", "Frontier capacity stays scarce until ~2027–28", "contested", "t-econ"),
    ("c-incremental", "Sustained cost declines come mostly from incremental work", "emerging", "t-cost"),
    ("c-arch-efficiency", "Recent architecture wins are efficiency; quality came from post-training", "emerging", "t-models"),
    ("c-rlvr-new", "RLVR creates genuinely new reasoning ability", "contested", "t-train"),
    ("c-distill-open", "Distillation from closed models drives open reasoning gains", "contested", "t-train"),
    ("c-specialists", "Specialists beat a generalist on their own turf", "contested", "t-train"),
    ("c-data-lever", "Data curation is the biggest lever", "emerging", "t-data"),
    ("c-hybrid-parity", "Hybrids match transformers at large scale", "emerging", "t-beyond"),
    ("c-diffusion-parity", "Diffusion LMs match autoregressive quality at 5–10× speed", "contested", "t-beyond"),
    ("c-glm52", "GLM-5.2 beats GPT-5.5 on long-horizon coding", "contested", "t-models"),
]
for id, title, consensus, topic in claims:
    g.c(id, title, "claim", ["claim"], attributes={"consensus": consensus})
    P(id, topic)
for a, b, t, note in [
    ("epoch", "c-100x", "supports", "all models at current list prices"),
    ("price-paper", "c-100x", "challenges", "controlled: 5–10×; algorithmic alone ~3×"),
    ("open-price", "c-100x", "challenges", "frozen proprietary list prices inflate it; open models 7–28×"),
    ("price-paper", "c-frontier-fastest", "supports", "top GPQA bin 31×/yr, bottom 1.7×/yr"),
    ("open-price", "c-frontier-fastest", "challenges", "open models fall fairly uniformly across quality"),
    ("nvidia", "c-squeeze", "supports", "'we are going to be short'"),
    ("accuris", "c-squeeze", "supports", "HBM sold out, 36–48 month transformer lead times"),
    ("stanford-toy", "c-squeeze", "challenges", "if demand growth slows to ~100%/yr, supply catches up"),
    ("moe", "c-incremental", "supports", "idea in 1991/2017, value from a decade of fixes"),
    ("algorithmic-progress", "c-incremental", "supports", "a smooth curve, not a staircase"),
    ("deepseek-v32", "c-arch-efficiency", "supports", "DSA aimed to lose nothing, not gain; RL drove capability"),
    ("deepseek-r1", "c-rlvr-new", "supports", "emergent self-reflection"),
    ("rlvr-study", "c-rlvr-new", "challenges", "sharpens sampling, narrows coverage"),
    ("tulu3", "c-distill-open", "supports", "SFT responses written by GPT-4o / Claude"),
    ("deepseek-r1", "c-distill-open", "challenges", "RLVR reasoning without a frontier teacher"),
    ("vl-study", "c-specialists", "supports", "5 of 7 tasks"),
    ("merging", "c-specialists", "supports", "labs specialize, then merge"),
    ("dclm", "c-data-lever", "supports", "+6 MMLU at half the compute"),
    ("jamba", "c-hybrid-parity", "supports", "competitive up to 398B"),
    ("granite-4", "c-hybrid-parity", "supports", "beat models 12× its size (vendor)"),
    ("robustness-paper", "c-hybrid-parity", "challenges", "robustness collapse from Mamba parts"),
    ("mercury", "c-diffusion-parity", "supports", "coding parity (vendor)"),
    ("gemini-diffusion", "c-diffusion-parity", "supports", "matches 2.0 Flash Lite on code (vendor)"),
    ("no-free-lunch", "c-diffusion-parity", "challenges", "speedups shrink under fair comparison"),
    ("glm52-late", "c-glm52", "supports", "unclear sourcing"),
    ("glm52-early", "c-glm52", "challenges", "no benchmarks published at launch"),
    ("vendor-claims", "c-hybrid-parity", "supports", "self-reported"),
]:
    R(a, b, t, note)

# ============================ Misconceptions ===================================
myths = [
    # myth id, myth, held by, reality id, reality, note, topic
    ("m-layers", "Each layer predicts a token, and the guesses get blended", "you",
     "r-layers", "Layers refine one vector in sequence; only the last one predicts", "an assembly line, not a panel of voters", "t-inside"),
    ("m-sonnet", "The 100×/year means a given Sonnet gets 100× cheaper", "you",
     "fixed-capability", None, "it's the cheapest model that clears a fixed bar", "t-cost"),
    ("m-harder", "Higher capability bars take cheap models longer to catch", "you",
     "c-frontier-fastest", None, "the frontier is where catch-up still has room — 31×/yr at the top, 1.7× at the bottom", "t-cost"),
    ("m-carbon", "claude-carbon's token cost is lossy", "you",
     "r-carbon", "Token cost is exact; only the CO₂ estimate is lossy", "cost comes straight from transcripts", "t-cost"),
    ("m-experts", "Experts are topic specialists (a 'chemistry expert')", "common",
     "r-experts", "Experts specialize in low-level token patterns, re-chosen every token at every layer", "routing is a dot product, not a topic dispatch", "t-moe"),
    ("m-gpu", "Capacity is all about GPUs", "common",
     "capacity", None, "power, HBM and electrical gear each bind in turn", "t-econ"),
    ("m-bigger", "Frontier models keep getting bigger", "common",
     "r-smaller", "Frontier models shrank after GPT-4; MoE split total from active parameters", "GPT-4o ~200B and 3.5 Sonnet ~400B (estimates) vs GPT-4 ~1.8T", "t-models"),
    ("m-moe-new", "MoE is a recent breakthrough", "common",
     "r-moe-old", "The idea dates to 1991; sparse gating to 2017", "its value came from years of incremental fixes", "t-moe"),
    ("m-price", "The price you pay tracks the cost to serve", "common",
     "price-vs-cost", None, "prices step down at successor launches", "t-cost"),
    ("m-distill", "A chunk of open reasoning gains is distillation doing the heavy lifting", "Claude",
     "r-distill", "Distillation can transfer reasoning, but there's no good evidence it drives the headline gains", "Claude retracted its own overreach", "t-train"),
]
for mid, myth, held, rid, reality, note, topic in myths:
    g.c(mid, myth, "claim", ["myth"], attributes={"held-by": held})
    P(mid, topic)
    if reality:
        g.c(rid, reality, "claim", ["reality"])
        P(rid, topic)
    R(rid, mid, "corrects", note)

# ============================ Rates & estimates =================================
rates = [
    # id, quantity, label, low, high, direction, method, source
    ("e-stock", "AI chip compute stock", "Doubling every ~7 months", 3.4, 3.4, "rise", "revenue, disclosures, analyst reports", "epoch"),
    ("e-train", "Frontier training compute", "Doubling every ~5.2 months", 5, 5, "rise", "tracked training runs", "epoch"),
    ("e-demand", "Compute demand", "~1,000,000× over two years", 1000, 1000, "rise", "keynote framing: per-request × usage", "nvidia"),
    ("e-capex", "Hyperscaler capex", "+36% in 2026", 1.36, 1.36, "rise", "company guidance", "semianalysis"),
    ("e-dc", "Data-center power supply", "~70 → ~220 GW in five years", 1.26, 1.26, "rise", "capacity forecast", "mckinsey"),
    ("e-dc-jll", "Data-center power supply", "~14% CAGR to 2030", 1.14, 1.14, "rise", "sector outlook", "jll"),
    ("e-hbm", "Memory share of AI spend", "~8% → ~30%, 2023 → 2026", 1.55, 1.55, "rise", "spend estimates", "semianalysis"),
    ("e-price-all", "Inference price at fixed capability", "All models, current list prices", 9, 900, "fall", "range across capability bars", "epoch"),
    ("e-price-top", "Inference price at fixed capability", "Top GPQA bin vs bottom bin", 1.7, 31, "fall", "by capability bin", "price-paper"),
    ("e-price-open", "Inference price at fixed capability", "Open-weight models (geo. mean 11.8×)", 7, 28, "fall", "open models only", "open-price"),
    ("e-price-frontier", "Inference price at fixed capability", "Frontier price-for-performance", 5, 10, "fall", "controls for frozen prices", "price-paper"),
    ("e-price-algo", "Inference price at fixed capability", "Algorithmic efficiency alone", 3, 3, "fall", "hardware & competition divided out", "price-paper"),
    ("e-pretrain-eff", "Pre-training compute efficiency", "Same capability, less compute", 3, 3, "rise", "algorithmic progress estimate", "epoch"),
    ("e-params-dense", "Frontier parameter count", "GPT-1 → GPT-3: 1000× in two years", 31, 31, "rise", "disclosed sizes", "epoch"),
    ("e-params-gpt4", "Frontier parameter count", "GPT-3 → GPT-4: ~10× in 2¾ years", 2.3, 2.3, "rise", "estimate for GPT-4", "epoch"),
    ("e-params-shrink", "Frontier parameter count", "After GPT-4: ~10× smaller (one step)", 10, 10, "fall", "estimates for GPT-4o, 3.5 Sonnet", "epoch"),
    ("e-moore", "Reference: Moore's law", "Doubling every ~2 years", 1.41, 1.41, "rise", "for scale", None),
]
for id, quantity, label, low, high, direction, method, src in rates:
    g.c(id, label, "measurement", ["rate"], attributes={"quantity": quantity, "low": low, "high": high, "direction": direction, "method": method})
    P(id, "rates")
    if src: R(id, src, "reported-by")

# ============================ Curation ==========================================
# Every Concept gets a home in the Outline (the statins graph left 36 unsorted).
for c in g.d["concepts"]:
    if c["kind"] == "claim" and not any(r["from"] == c["id"] and r["type"] == "part-of" for r in g.d["relationships"]):
        P(c["id"], "t-cost")

# ================================= Views ======================================
g.view("outline", "Outline", "outline",
       "The whole session regrouped into nine topics, from compute economics to post-transformer architectures.",
       relationshipTypes=["part-of"], rootTag="topic", openDepth=1)
g.view("anatomy", "Anatomy", "anatomy",
       "The transformer as nested parts (DeepSeek-V3's shape), with every technique pinned to the part it changes. Colour is maturity.",
       roots=["transformer"], containment=["part-of"], pins=["modifies"], colorBy="stage")
g.view("learn", "Learning path", "learning-path",
       "Every technique and the foundations they share. Click one to see what you need first, in order; mark what you already know to shorten it.",
       relationshipTypes=["prerequisite"], targets={"tags": ["technique"]}, minSteps=5)
g.view("lineage", "Lineage", "lineage",
       "Where each idea came from and what it led to, over time. One band per area; links that cross bands are ideas borrowed across areas.",
       relationshipTypes=["led-to"], tags=["technique", "component"], groupBy="area")
g.view("maturity", "Maturity", "quadrant",
       "How proven each technique is: research → small-scale → shipped in an open model → standard. Rows are the part of the model it touches.",
       x="stage", y="area", tags=["technique"], progression=True, evidence=["uses"])
g.view("quadrant", "Efficiency vs quality", "quadrant",
       "What each technique buys (efficiency or quality) against when it's applied (serving, post-training, or baked into the architecture).",
       x="effect", y="applies", tags=["technique"])
g.view("models", "Open models", "comparison-table",
       "The published open models side by side. Blank means the chat didn't give a reliable number.",
       rows={"kinds": ["thing"], "tags": ["open-model"]},
       columns=[{"attribute": a} for a in ["developer", "total", "active", "experts", "active-experts", "shared-expert", "attention", "layers", "context", "notes"]],
       sortBy="total")
g.view("techniques", "Techniques", "comparison-table",
       "Every technique: what it attacks, what it buys, when it's applied, and how proven it is.",
       rows={"kinds": ["idea"], "tags": ["technique"], "hasAttribute": "effect"},
       columns=[{"attribute": a} for a in ["area", "bottleneck", "effect", "applies", "stage"]])
g.view("evidence", "Evidence", "evidence",
       "The contested and emerging claims, with who backs them. Badges show how independent each source is.",
       supports=["supports"], challenges=["challenges"], claimKinds=["claim"], evidenceType="independence", consensus="consensus")
g.view("rates", "Rates & estimates", "rates",
       "Every growth or decline rate quoted, per year, on one log scale. Several estimates of one quantity show how much the method matters.",
       group="quantity", low="low", high="high", direction="direction", method="method",
       sourceRelationship="reported-by", independence="independence")
g.view("economics", "Compute economics", "cause-and-effect",
       "What drives frontier inference price up or down. Select anything to trace it.",
       mode="mechanism", positive=["raises"], negative=["lowers"], outcomes=["frontier-price"], levers={"tags": ["lever"]})
g.view("timeline", "Timeline", "timeline",
       "Ideas, models and the compute market on one axis, from MoE in 1991 to nuclear after 2035. Opens on the modern era.",
       lanes=[{"id": "ideas", "label": "Ideas"}, {"id": "models", "label": "Models"}, {"id": "market", "label": "Compute & market"}],
       focus=["2016-06", "2027-06"])

# Reader-facing content (overview paragraph + optional article), written per
# topic batch into content/compute/*.json.
import json, pathlib
for f in sorted((pathlib.Path(__file__).parent / "content" / "compute").glob("*.json")):
    for id, text in json.loads(f.read_text()).items():
        if id in g.ids:
            g.patch(id, **{k: v for k, v in text.items() if k in ("overview", "article")})

g.write()
