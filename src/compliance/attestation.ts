import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectContexts } from "../detector/tree-walker.js";
import { resolveWorkspaceMembers } from "../workspace/config.js";
import type {
  AttestationVerificationResult,
  DsseEnvelope,
  InTotoStatement,
  InTotoSubject,
} from "./types.js";

export class AttestationEngine {
  /**
   * Generates a standard in-toto SLSA Provenance v1.0 Statement for workspace artifacts.
   */
  generateStatement(options: {
    workspaceDir: string;
    subjects?: string[];
    builderVersion?: string;
  }): InTotoStatement {
    const wsDir = path.resolve(options.workspaceDir);
    const version = options.builderVersion || "0.5.0";

    const subjectList: InTotoSubject[] = [];

    // Default subject files: poly.lock and poly.toml
    const candidateFiles = options.subjects || ["poly.lock", "poly.toml"];
    for (const relFile of candidateFiles) {
      const fullPath = path.join(wsDir, relFile);
      if (fs.existsSync(fullPath)) {
        const fileBytes = fs.readFileSync(fullPath);
        const digest = crypto.createHash("sha256").update(fileBytes).digest("hex");
        subjectList.push({
          name: relFile,
          digest: { sha256: digest },
        });
      }
    }

    // Detect members and ecosystems
    const members = resolveWorkspaceMembers(wsDir);
    const contexts = detectContexts(wsDir);
    const ecosystems = new Set<string>();
    for (const m of members) ecosystems.add(m.context.ecosystem);
    for (const c of contexts) ecosystems.add(c.ecosystem);

    // Compute lockfile hash if present
    let lockfileHash: string | undefined;
    const lockPath = path.join(wsDir, "poly.lock");
    if (fs.existsSync(lockPath)) {
      lockfileHash = crypto.createHash("sha256").update(fs.readFileSync(lockPath)).digest("hex");
    }

    // Git metadata
    let gitCommit: string | undefined;
    let gitBranch: string | undefined;
    try {
      const headPath = path.join(wsDir, ".git", "HEAD");
      if (fs.existsSync(headPath)) {
        const headContent = fs.readFileSync(headPath, "utf-8").trim();
        if (headContent.startsWith("ref: ")) {
          gitBranch = headContent.replace("ref: refs/heads/", "");
          const refPath = path.join(wsDir, ".git", headContent.replace("ref: ", ""));
          if (fs.existsSync(refPath)) {
            gitCommit = fs.readFileSync(refPath, "utf-8").trim();
          }
        } else {
          gitCommit = headContent;
        }
      }
    } catch {
      // Best-effort git metadata inspection
    }

    const now = new Date().toISOString();

    return {
      _type: "https://in-toto.io/Statement/v1",
      subject: subjectList,
      predicateType: "https://slsa.dev/provenance/v1",
      predicate: {
        buildDefinition: {
          buildType: "https://poly.ritualdev.in/slsa/v1",
          externalParameters: {
            workspaceDir: path.basename(wsDir),
            lockfileHash,
            ecosystems: Array.from(ecosystems),
          },
          systemParameters: {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            gitCommit,
            gitBranch,
            ciRunner: process.env.GITHUB_ACTIONS ? "GitHub Actions" : os.hostname(),
          },
        },
        runDetails: {
          builder: {
            id: "https://github.com/RitualDev-Lab/poly",
            version,
          },
          metadata: {
            invocationId: crypto.randomUUID(),
            startedOn: now,
            finishedOn: now,
          },
        },
      },
    };
  }

  /**
   * Cryptographically signs an in-toto statement and packages into a DSSE envelope.
   * Supports Ed25519 and RSA private keys.
   */
  signStatement(
    statement: InTotoStatement,
    privateKeyPem: string,
    keyId = "poly-attest-key-1",
  ): DsseEnvelope {
    const payloadStr = JSON.stringify(statement);
    const payloadBuffer = Buffer.from(payloadStr, "utf-8");
    const payloadBase64 = payloadBuffer.toString("base64");

    // Determine key type and sign using KeyObject
    const keyObj = crypto.createPrivateKey(privateKeyPem);
    let signatureBuffer: Buffer;
    if (keyObj.asymmetricKeyType === "ed25519") {
      signatureBuffer = crypto.sign(null, payloadBuffer, keyObj);
    } else {
      signatureBuffer = crypto.sign("sha256", payloadBuffer, keyObj);
    }

    return {
      payloadType: "application/vnd.in-toto+json",
      payload: payloadBase64,
      signatures: [
        {
          keyid: keyId,
          sig: signatureBuffer.toString("base64"),
        },
      ],
    };
  }

  /**
   * Verifies DSSE signature and artifact hashes against on-disk subjects.
   */
  verifyEnvelope(
    envelope: DsseEnvelope,
    publicKeyPem: string,
    workspaceDir?: string,
  ): AttestationVerificationResult {
    let statement: InTotoStatement;
    let payloadBuffer: Buffer;

    try {
      payloadBuffer = Buffer.from(envelope.payload, "base64");
      statement = JSON.parse(payloadBuffer.toString("utf-8")) as InTotoStatement;
    } catch (e) {
      return {
        valid: false,
        signatureVerified: false,
        subjectsVerified: false,
        subjectResults: [],
        error: `Failed to decode envelope payload: ${String(e)}`,
      };
    }

    if (!envelope.signatures || envelope.signatures.length === 0) {
      return {
        valid: false,
        signatureVerified: false,
        subjectsVerified: false,
        subjectResults: [],
        statement,
        error: "Envelope contains no cryptographic signatures",
      };
    }

    // Verify first signature
    const sig = envelope.signatures[0];
    const sigBuffer = Buffer.from(sig.sig, "base64");

    let signatureVerified = false;
    try {
      const pubKeyObj = crypto.createPublicKey(publicKeyPem);
      if (pubKeyObj.asymmetricKeyType === "ed25519") {
        signatureVerified = crypto.verify(null, payloadBuffer, pubKeyObj, sigBuffer);
      } else {
        signatureVerified = crypto.verify("sha256", payloadBuffer, pubKeyObj, sigBuffer);
      }
    } catch (e) {
      return {
        valid: false,
        signatureVerified: false,
        subjectsVerified: false,
        subjectResults: [],
        statement,
        error: `Signature verification exception: ${String(e)}`,
      };
    }

    if (!signatureVerified) {
      return {
        valid: false,
        signatureVerified: false,
        subjectsVerified: false,
        subjectResults: [],
        statement,
        error:
          "Cryptographic signature mismatch. Envelope has been tampered with or key is invalid.",
      };
    }

    // Verify subjects against on-disk files if workspaceDir provided
    const subjectResults: AttestationVerificationResult["subjectResults"] = [];
    let subjectsVerified = true;

    if (workspaceDir) {
      const wsDir = path.resolve(workspaceDir);
      for (const s of statement.subject) {
        const filePath = path.join(wsDir, s.name);
        if (!fs.existsSync(filePath)) {
          subjectsVerified = false;
          subjectResults.push({
            name: s.name,
            expectedHash: s.digest.sha256,
            actualHash: undefined,
            matches: false,
          });
        } else {
          const actual = crypto
            .createHash("sha256")
            .update(fs.readFileSync(filePath))
            .digest("hex");
          const matches = actual === s.digest.sha256;
          if (!matches) subjectsVerified = false;

          subjectResults.push({
            name: s.name,
            expectedHash: s.digest.sha256,
            actualHash: actual,
            matches,
          });
        }
      }
    }

    return {
      valid: signatureVerified && (workspaceDir ? subjectsVerified : true),
      signatureVerified,
      subjectsVerified: workspaceDir ? subjectsVerified : true,
      subjectResults,
      statement,
    };
  }

  /**
   * Generates a new cryptographic Ed25519 keypair in PKCS8/SPKI PEM format.
   */
  generateKeyPair(): { privateKey: string; publicKey: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    return { privateKey, publicKey };
  }
}
