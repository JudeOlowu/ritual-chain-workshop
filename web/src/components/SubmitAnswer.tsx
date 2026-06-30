"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress, isContractConfigured } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canCommit, canReveal, type Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import { encodePacked, keccak256 } from "viem";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Input,
  Button,
  TxStatus,
  Notice,
  Spinner,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function SubmitAnswer({
  bountyId,
  bounty,
  onSubmitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onSubmitted: () => void;
}) {
  const { address, isConnected } = useAccount();
  const now = useNow();

  // Commit and Reveal answers states
  const [commitAnswer, setCommitAnswer] = useState("");
  const [manualAnswer, setManualAnswer] = useState("");
  const [manualSalt, setManualSalt] = useState("");
  const [manualMode, setManualMode] = useState(false);

  // Stored commitment state
  const [storedCommit, setStoredCommit] = useState<{
    answer: string;
    salt: string;
  } | null>(null);

  const [hasRevealedLocal, setHasRevealedLocal] = useState(false);

  // Load stored commitment info on mount/account change
  useEffect(() => {
    if (!address) return;
    const key = `bounty_commit_${bountyId}_${address}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        setStoredCommit(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse stored commitment data", e);
      }
    } else {
      setStoredCommit(null);
    }

    const revealedKey = `bounty_revealed_${bountyId}_${address}`;
    setHasRevealedLocal(localStorage.getItem(revealedKey) === "true");
  }, [bountyId, address]);

  // Read commitment status from the blockchain
  const {
    data: commitmentHash,
    refetch: refetchCommitment,
    isLoading: isCommitmentLoading,
  } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "commitments",
    args: address && bountyId !== undefined ? [bountyId, address] : undefined,
    chainId: ritualChain.id,
    query: {
      enabled: !!address && bountyId !== undefined && isContractConfigured,
    },
  });

  // TX wrappers
  const txCommit = useWriteTx(() => {
    // Refresh commitment on confirmation
    void refetchCommitment();
  });

  const txReveal = useWriteTx(() => {
    if (address) {
      const revealedKey = `bounty_revealed_${bountyId}_${address}`;
      localStorage.setItem(revealedKey, "true");
      setHasRevealedLocal(true);

      const commitKey = `bounty_commit_${bountyId}_${address}`;
      localStorage.removeItem(commitKey);
      setStoredCommit(null);
    }
    onSubmitted();
  });

  // Determine current phases
  const commitPhase = canCommit(bounty, now / 1000);
  const revealPhase = canReveal(bounty, now / 1000);
  const hasCommitted = commitmentHash !== undefined && commitmentHash !== ZERO_HASH;

  // We should not show anything if the bounty is already judged or finalized
  if (bounty.judged || bounty.finalized) {
    return null;
  }

  // Handle Commit Form Submit
  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!commitAnswer.trim() || !contractAddress || !address) return;

    try {
      // Generate a secure 32-byte salt hex
      const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
      const saltHex = ("0x" +
        Array.from(randomBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")) as `0x${string}`;

      // Calculate commitment: keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
      const commitment = keccak256(
        encodePacked(
          ["string", "bytes32", "address", "uint256"],
          [commitAnswer.trim(), saltHex, address, bountyId]
        )
      );

      // Run tx
      await txCommit.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, commitment],
        chainId: ritualChain.id,
      });

      // Save salt and plaintext to localStorage
      const key = `bounty_commit_${bountyId}_${address}`;
      localStorage.setItem(
        key,
        JSON.stringify({ answer: commitAnswer.trim(), salt: saltHex })
      );
      setStoredCommit({ answer: commitAnswer.trim(), salt: saltHex });
      setCommitAnswer("");
      void refetchCommitment();
    } catch (err) {
      console.error("Commit failed", err);
    }
  }

  // Handle Reveal Form Submit
  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!contractAddress || !address) return;

    const answerToReveal = manualMode ? manualAnswer.trim() : storedCommit?.answer || "";
    const saltToReveal = manualMode ? manualSalt.trim() : storedCommit?.salt || "";

    if (!answerToReveal || !saltToReveal) return;

    try {
      await txReveal.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, answerToReveal, saltToReveal as `0x${string}`],
        chainId: ritualChain.id,
      });
    } catch (err) {
      console.error("Reveal failed", err);
    }
  }

  if (!isConnected) {
    return (
      <Card>
        <CardHeader
          title="Submit or Reveal Answer"
          subtitle="Participant submission dashboard"
        />
        <CardBody className="text-center py-6">
          <p className="text-sm text-zinc-400">
            Please connect your wallet to submit commitments or reveal answers.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      {commitPhase && (
        <>
          <CardHeader
            title="Commitment Submission Phase"
            subtitle="Submit a hashed commitment. Plaintext remains private until the deadline passes."
          />
          <CardBody>
            {isCommitmentLoading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400 py-3">
                <Spinner /> Checking commitment status…
              </div>
            ) : hasCommitted ? (
              <div className="space-y-4 py-2">
                <Notice tone="green">
                  ✓ Commitment submitted successfully! Your cryptographic hash is stored on-chain.
                </Notice>
                {storedCommit && (
                  <div className="rounded-xl border border-white/5 bg-black/30 p-3 text-xs space-y-2">
                    <div className="font-semibold text-zinc-300">Saved Submission Details (Browser Storage)</div>
                    <div className="text-zinc-400">
                      <span className="text-zinc-500">Answer:</span> &quot;{storedCommit.answer}&quot;
                    </div>
                    <div className="font-mono text-zinc-500">
                      <span>Salt:</span> {storedCommit.salt}
                    </div>
                    <div className="text-[10px] text-amber-400/80 leading-relaxed pt-1 border-t border-white/5">
                      ⚠ Keep this browser session open or note down your salt and answer. You will need them to reveal your submission when the timer runs out!
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleCommit} className="space-y-3">
                <Field label="Your Plaintext Answer" hint="Your answer will be hashed client-side with a random cryptographic salt before submission.">
                  <Textarea
                    value={commitAnswer}
                    onChange={(e) => setCommitAnswer(e.target.value)}
                    rows={5}
                    placeholder="Enter your private bounty submission here…"
                    disabled={txCommit.isBusy}
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={!commitAnswer.trim() || txCommit.isBusy}
                  className="w-full"
                >
                  {txCommit.isBusy ? "Submitting Commitment…" : "Submit Commitment Hash"}
                </Button>
                <TxStatus
                  state={txCommit.state}
                  error={txCommit.error}
                  hash={txCommit.hash}
                  explorerBase={explorerBase}
                />
              </form>
            )}
          </CardBody>
        </>
      )}

      {revealPhase && (
        <>
          <CardHeader
            title="Reveal Answer Phase"
            subtitle="The submission phase has closed. Reveal your answer to make it eligible for AI judging."
          />
          <CardBody>
            {hasRevealedLocal ? (
              <Notice tone="green">
                ✓ Your answer has been successfully revealed! It is now visible to the AI judge.
              </Notice>
            ) : isCommitmentLoading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400 py-3">
                <Spinner /> Checking commitment status…
              </div>
            ) : !hasCommitted ? (
              <div className="space-y-3 py-2">
                <Notice tone="amber">
                  No active commitment found for this account.
                </Notice>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Either you have already revealed your answer, or you did not submit a commitment during the submission phase. Uncommitted accounts are not eligible to submit answers now.
                </p>
              </div>
            ) : (
              <form onSubmit={handleReveal} className="space-y-4">
                {!manualMode && storedCommit ? (
                  <div className="space-y-3">
                    <Notice tone="indigo">
                      Found saved commitment details in your browser local storage!
                    </Notice>
                    <div className="rounded-xl border border-white/5 bg-black/30 p-3 text-xs space-y-2">
                      <div>
                        <span className="text-zinc-500 font-semibold">Saved Answer:</span>
                        <p className="mt-1 text-zinc-300 bg-black/20 p-2 rounded border border-white/5 whitespace-pre-wrap">
                          {storedCommit.answer}
                        </p>
                      </div>
                      <div className="font-mono">
                        <span className="text-zinc-500 font-semibold">Saved Salt:</span>
                        <p className="mt-0.5 text-zinc-400 bg-black/20 p-1 px-2 rounded border border-white/5 break-all">
                          {storedCommit.salt}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={txReveal.isBusy}
                      className="w-full"
                    >
                      {txReveal.isBusy ? "Revealing Answer…" : "Reveal Stored Answer"}
                    </Button>
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => setManualMode(true)}
                        className="text-xs text-zinc-500 hover:text-zinc-400 underline underline-offset-2"
                      >
                        Enter answer and salt manually instead
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Notice tone="amber">
                      No local commitment data found. Please enter your submission details manually to reveal.
                    </Notice>
                    <Field label="Plaintext Answer">
                      <Textarea
                        value={manualAnswer}
                        onChange={(e) => setManualAnswer(e.target.value)}
                        rows={4}
                        placeholder="Enter the EXACT answer you committed…"
                        disabled={txReveal.isBusy}
                      />
                    </Field>
                    <Field label="Cryptographic Salt (bytes32 hex)">
                      <Input
                        value={manualSalt}
                        onChange={(e) => setManualSalt(e.target.value)}
                        placeholder="e.g. 0x5a1f..."
                        disabled={txReveal.isBusy}
                      />
                    </Field>
                    <Button
                      type="submit"
                      disabled={!manualAnswer.trim() || !manualSalt.startsWith("0x") || txReveal.isBusy}
                      className="w-full"
                    >
                      {txReveal.isBusy ? "Verifying and Revealing…" : "Verify and Reveal Answer"}
                    </Button>
                    {storedCommit && (
                      <div className="text-center">
                        <button
                          type="button"
                          onClick={() => setManualMode(false)}
                          className="text-xs text-zinc-500 hover:text-zinc-400 underline underline-offset-2"
                        >
                          Use saved browser data
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <TxStatus
                  state={txReveal.state}
                  error={txReveal.error}
                  hash={txReveal.hash}
                  explorerBase={explorerBase}
                />
              </form>
            )}
          </CardBody>
        </>
      )}
    </Card>
  );
}
