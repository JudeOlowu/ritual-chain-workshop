# Privacy-Preserving AI Bounty Judge

This repository contains an updated implementation of the `AIJudge` smart contract, designed to tackle the **Privacy-Preserving AI Bounty Judge** assignment. Our implementation fulfills the **Required Track** (Commit-Reveal flow) while comprehensively solving the **Advanced Track** (Ritual-Native Hidden Submissions).

## 1. Lifecycle Explanation

The new lifecycle of the bounty process ensures that all answers remain hidden, not just during the submission phase, but indefinitely.

1. **Bounty Creation (`createBounty`)**: A sponsor creates a bounty with a defined rubric, deadline, and reward.
2. **Off-Chain Encryption**: Instead of hashing a plaintext string, participants encrypt their submission using the Ritual TEE's public key. The plaintext never touches the blockchain.
3. **Commitment Submission (`submitCommitment`)**: Before the deadline, the participant hashes their encrypted payload (with a salt) and submits this `bytes32` commitment on-chain. This locks in their participation without revealing their encrypted payload or front-running vulnerabilities.
4. **Reveal Phase (`revealAnswer`)**: After the deadline, the participant submits their fully encrypted payload (as a `string calldata` representing the ciphertext) alongside their salt. The smart contract hashes this payload and checks it against their commitment. If it matches, the ciphertext is appended to the `bounty.submissions` array.
5. **AI Judging (`judgeAll`)**: The bounty owner fetches the array of ciphertexts from the blockchain, batches them into a single `llmInput` prompt, and sends them to the contract. The Ritual TEE decrypts the payloads securely within its enclave, evaluates them against the rubric, and returns the AI review and winner index. 

## 2. Architecture Note (Advanced Track)

By combining standard Commit-Reveal with TEE-backed payload encryption, we achieve a hybrid zero-knowledge-like architecture.

*   **What exists in Plaintext:** The plaintext answer exists **only** locally on the participant's machine during encryption, and ephemerally inside the secure memory enclave (TEE) of the Ritual node during the `judgeAll` execution. It is never stored or broadcast in plaintext.
*   **What is stored On-Chain:** The blockchain stores the `bytes32` commitment hashes during the active phase, and the encrypted ciphertexts (in the `Submission` array) during the reveal phase. 
*   **Batch LLM Judging:** Instead of making individual precompile calls per submission, the owner constructs an off-chain JSON array containing all valid encrypted submissions. This batched array is passed as `llmInput` to the TEE. The TEE's internal logic decrypts the array, feeds the plaintext batch to the LLM model in a single prompt context, and returns the aggregated output. This minimizes gas costs and precompile latency.

## 3. Test Plan for Reveal Cases

To ensure the integrity of the commit-reveal flow, the following test cases must be evaluated using Hardhat and `ethers.js`:

1.  **Successful Reveal:** Verify that a commitment generated off-chain using `ethers.utils.solidityKeccak256` perfectly matches the on-chain hash generation, allowing a valid payload and salt to be added to the submissions array.
2.  **Invalid Salt:** Test that providing the correct encrypted payload but the wrong salt reverts the `revealAnswer` transaction.
3.  **Invalid Payload:** Test that providing the correct salt but a modified encrypted payload (e.g., tampered ciphertext) reverts the transaction.
4.  **Premature Reveal:** Ensure that calling `revealAnswer` *before* the bounty deadline has passed reverts the transaction to prevent early leaking of ciphertexts.
5.  **Late Commitment:** Ensure that calling `submitCommitment` *after* the bounty deadline reverts the transaction.
6.  **Double Reveal:** Verify that after a successful reveal, the commitment is cleared (set to `bytes32(0)`), preventing the same user from revealing twice and bloating the submissions array.

## 4. Reflection Question

**What should be public, what should stay hidden, and what should be decided by AI versus by a human in a bounty system?**

In a bounty system, the rubric, the total reward pool, and the final scoring justification should remain completely public to guarantee transparency and trust in the process. However, the actual submission contents should remain hidden—even after the deadline—using TEE encryption, preventing competitors from stealing proprietary code or ideas for future bounties. The AI is uniquely suited to objectively evaluate submissions against the rubric at scale, eliminating human biases, fatigue, and nepotism during the initial filtering and scoring phases. Conversely, humans should retain the final decision-making power for edge cases, dispute resolution, and defining the qualitative intent behind the rubric that an AI might misinterpret. Ultimately, the AI acts as an impartial cryptographic oracle, while humans enforce the social consensus layer.
