import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  api,
  type AuditEntry,
  type Claim,
  type ClaimSummary,
  type DemoUser,
  type EffectWarning,
  type RequiredDocument,
  type TransitionPreview,
  type TransitionResult,
} from "./api";

type Notice = {
  readonly title: string;
  readonly message: string;
  readonly warnings?: readonly EffectWarning[];
};

const numberFormatter = new Intl.NumberFormat("en", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function shortId(id: string): string {
  return id.split("-")[0]?.toUpperCase() ?? id;
}

function formatDate(value: string | null): string {
  return value === null ? "Not recorded" : dateFormatter.format(new Date(value));
}

function errorDetails(error: ApiError): readonly string[] {
  if (typeof error.details !== "object" || error.details === null) {
    return error.details === undefined ? [] : [String(error.details)];
  }
  const details = error.details as Record<string, unknown>;
  const violations = details.violations;
  if (Array.isArray(violations)) {
    return violations.map(String);
  }
  const failures = details.failures;
  if (Array.isArray(failures)) {
    return failures.map((failure) => {
      if (typeof failure === "object" && failure !== null && "message" in failure) {
        return String((failure as { message: unknown }).message);
      }
      return String(failure);
    });
  }
  const requiredRoles = details.requiredRoles;
  if (Array.isArray(requiredRoles)) {
    return [`Required role: ${requiredRoles.map(String).join(", ")}`];
  }
  return Object.entries(details).map(([key, value]) => `${key}: ${String(value)}`);
}

function ErrorPanel({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const details = errorDetails(error);
  return (
    <section className="alert alert-error" role="alert" aria-live="assertive">
      <div>
        <p className="alert-kicker">{error.code}</p>
        <h2>{error.message}</h2>
        {details.length > 0 && (
          <ul>
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
      {onRetry !== undefined && (
        <button className="button button-secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

function NoticePanel({ notice }: { notice: Notice }) {
  const hasWarnings = (notice.warnings?.length ?? 0) > 0;
  return (
    <section
      className={`alert ${hasWarnings ? "alert-warning" : "alert-success"}`}
      role="status"
      aria-live="polite"
      data-testid={hasWarnings ? "effect-warning" : "success-notice"}
    >
      <div>
        <p className="alert-kicker">{hasWarnings ? "Completed with follow-up warning" : "Success"}</p>
        <h2>{notice.title}</h2>
        <p>{notice.message}</p>
        {hasWarnings && (
          <ul>
            {notice.warnings?.map((warning) => (
              <li key={`${warning.effectType}-${warning.message}`}>
                <strong>{warning.effectType}:</strong> {warning.message}. The transition and audit
                entry are already committed.
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DocumentsForm({
  claim,
  pending,
  onSave,
}: {
  claim: Claim;
  pending: boolean;
  onSave: (documents: readonly RequiredDocument[]) => Promise<void>;
}) {
  const [documents, setDocuments] = useState<readonly RequiredDocument[]>(claim.requiredDocuments);

  useEffect(() => setDocuments(claim.requiredDocuments), [claim.id, claim.requiredDocuments]);

  function update(index: number, field: "present" | "valid", checked: boolean) {
    setDocuments((current) =>
      current.map((document, candidateIndex) =>
        candidateIndex === index ? { ...document, [field]: checked } : document,
      ),
    );
  }

  return (
    <form
      className="prep-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(documents);
      }}
    >
      <div className="form-heading">
        <div>
          <p className="eyebrow">Prerequisite data</p>
          <h3>Required documents</h3>
        </div>
        <span className="role-tag">document_clerk</span>
      </div>
      {documents.map((document, index) => (
        <fieldset className="document-row" key={`${document.type}-${index}`}>
          <legend>{document.type}</legend>
          <label className="check-label">
            <input
              type="checkbox"
              checked={document.present}
              onChange={(event) => update(index, "present", event.currentTarget.checked)}
            />
            Present
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={document.valid}
              onChange={(event) => update(index, "valid", event.currentTarget.checked)}
            />
            Valid
          </label>
        </fieldset>
      ))}
      <button className="button button-primary" disabled={pending} type="submit">
        {pending ? "Saving…" : "Save document status"}
      </button>
    </form>
  );
}

function AssessorForm({
  users,
  pending,
  onSave,
}: {
  users: readonly DemoUser[];
  pending: boolean;
  onSave: (assessorId: string) => Promise<void>;
}) {
  const assessors = users.filter((user) => user.role === "assessor");
  const [assessorId, setAssessorId] = useState(assessors[0]?.id ?? "");
  return (
    <form
      className="prep-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(assessorId);
      }}
    >
      <div className="form-heading">
        <div>
          <p className="eyebrow">Prerequisite data</p>
          <h3>Assign an assessor</h3>
        </div>
        <span className="role-tag">team_lead</span>
      </div>
      <label>
        Assessor
        <select value={assessorId} onChange={(event) => setAssessorId(event.currentTarget.value)}>
          {assessors.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </select>
      </label>
      <button className="button button-primary" disabled={pending || assessorId === ""} type="submit">
        {pending ? "Assigning…" : "Assign assessor"}
      </button>
    </form>
  );
}

function AssessmentForm({
  pending,
  onSave,
}: {
  pending: boolean;
  onSave: (report: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const [conclusion, setConclusion] = useState("approve");
  const [notes, setNotes] = useState("");
  return (
    <form
      className="prep-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ conclusion, notes: notes.trim() });
      }}
    >
      <div className="form-heading">
        <div>
          <p className="eyebrow">Prerequisite data</p>
          <h3>Complete assessment report</h3>
        </div>
        <span className="role-tag">assessor</span>
      </div>
      <label>
        Conclusion
        <select value={conclusion} onChange={(event) => setConclusion(event.currentTarget.value)}>
          <option value="approve">Recommend approval</option>
          <option value="reject">Recommend rejection</option>
        </select>
      </label>
      <label>
        Report notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
          placeholder="Summarize the assessment"
          required
        />
      </label>
      <button className="button button-primary" disabled={pending || notes.trim() === ""} type="submit">
        {pending ? "Saving…" : "Complete report"}
      </button>
    </form>
  );
}

function AdditionalInformationForm({
  pending,
  onSave,
}: {
  pending: boolean;
  onSave: (isValid: boolean, metadata: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const [fileName, setFileName] = useState("");
  const [isValid, setIsValid] = useState(true);
  return (
    <form
      className="prep-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(isValid, { fileName: fileName.trim() });
      }}
    >
      <div className="form-heading">
        <div>
          <p className="eyebrow">Prerequisite data</p>
          <h3>Record additional information</h3>
        </div>
        <span className="role-tag">document_clerk</span>
      </div>
      <label>
        File or record name
        <input
          value={fileName}
          onChange={(event) => setFileName(event.currentTarget.value)}
          placeholder="invoice-v2.pdf"
          required
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={isValid}
          onChange={(event) => setIsValid(event.currentTarget.checked)}
        />
        Information is valid
      </label>
      <button className="button button-primary" disabled={pending || fileName.trim() === ""} type="submit">
        {pending ? "Recording…" : "Record information"}
      </button>
    </form>
  );
}

function PaymentForm({
  pending,
  onSave,
}: {
  pending: boolean;
  onSave: (reference: string) => Promise<void>;
}) {
  const [reference, setReference] = useState("");
  return (
    <form
      className="prep-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(reference.trim());
      }}
    >
      <div className="form-heading">
        <div>
          <p className="eyebrow">Prerequisite data</p>
          <h3>Confirm mock payment</h3>
        </div>
        <span className="role-tag">finance</span>
      </div>
      <label>
        Payment reference
        <input
          value={reference}
          onChange={(event) => setReference(event.currentTarget.value)}
          placeholder="PAY-DEMO-001"
          required
        />
      </label>
      <button className="button button-primary" disabled={pending || reference.trim() === ""} type="submit">
        {pending ? "Confirming…" : "Confirm payment"}
      </button>
    </form>
  );
}

function TransitionCard({
  transition,
  pending,
  onRun,
}: {
  transition: TransitionPreview;
  pending: boolean;
  onRun: (input: {
    readonly transitionId: string;
    readonly reason?: string;
    readonly rejectionReason?: string;
    readonly missingInfoDescription?: string;
  }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [commandInput, setCommandInput] = useState("");
  const commandFact =
    transition.transitionId === "reject_claim"
      ? "command.rejectionReason"
      : transition.transitionId === "request_more_info"
        ? "command.missingInfoDescription"
        : null;
  const blockingConditions = transition.unmetConditions.filter(
    (condition) => condition.fact !== commandFact,
  );
  const needsCommandInput = commandFact !== null;
  const canRun =
    transition.authorized &&
    blockingConditions.length === 0 &&
    (!needsCommandInput || commandInput.trim() !== "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    const trimmedCommand = commandInput.trim();
    void onRun({
      transitionId: transition.transitionId,
      ...(trimmedReason === "" ? {} : { reason: trimmedReason }),
      ...(transition.transitionId === "reject_claim"
        ? { rejectionReason: trimmedCommand }
        : {}),
      ...(transition.transitionId === "request_more_info"
        ? { missingInfoDescription: trimmedCommand }
        : {}),
    });
  }

  return (
    <form className="transition-card" onSubmit={submit} data-testid={`transition-${transition.transitionId}`}>
      <div className="transition-topline">
        <span className={`availability ${canRun ? "ready" : "blocked"}`}>
          {canRun ? "Ready" : transition.authorized ? "Prerequisites needed" : "Different role needed"}
        </span>
        <span className="role-tag">{transition.requiredRoles.join(" · ")}</span>
      </div>
      <h3>{transition.transitionLabel}</h3>
      <p className="state-route">
        {transition.fromStateLabel} <span aria-hidden="true">→</span> {transition.toStateLabel}
      </p>
      {transition.unmetConditions.length > 0 && (
        <div className="condition-list">
          <p>Conditions</p>
          <ul>
            {transition.unmetConditions.map((condition) => (
              <li key={`${condition.code}-${condition.fact ?? condition.message}`}>
                <span aria-hidden="true">{condition.fact === commandFact ? "○" : "×"}</span>
                {condition.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {transition.transitionId === "reject_claim" && (
        <label>
          Rejection reason
          <textarea
            value={commandInput}
            onChange={(event) => setCommandInput(event.currentTarget.value)}
            required
          />
        </label>
      )}
      {transition.transitionId === "request_more_info" && (
        <label>
          Missing information description
          <textarea
            value={commandInput}
            onChange={(event) => setCommandInput(event.currentTarget.value)}
            required
          />
        </label>
      )}
      <label>
        Transition notes <span className="optional">Optional</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          placeholder="Add a note for the audit trail"
        />
      </label>
      <button className="button button-dark" type="submit" disabled={pending || !canRun}>
        {pending ? "Working…" : `Run · ${transition.transitionLabel}`}
      </button>
    </form>
  );
}

function AuditTimeline({ entries }: { entries: readonly AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <span>00</span>
        <h3>No transitions yet</h3>
        <p>The immutable history will appear here after the first successful transition.</p>
      </div>
    );
  }
  return (
    <ol className="timeline">
      {entries.map((entry) => (
        <li key={entry.sequence}>
          <div className="timeline-index">{String(entry.sequence).padStart(2, "0")}</div>
          <div className="timeline-content">
            <div className="timeline-heading">
              <div>
                <h3>{entry.transitionLabel}</h3>
                <p className="state-route">
                  {entry.fromStateLabel} <span aria-hidden="true">→</span> {entry.toStateLabel}
                </p>
              </div>
              <time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt)}</time>
            </div>
            <div className="audit-meta">
              <span>{entry.triggeredByUserId}</span>
              <span className="role-tag">{entry.triggeredByRole}</span>
            </div>
            <p className={entry.reason === null ? "muted" : ""}>
              {entry.reason ?? "No notes supplied"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ClaimFacts({ claim }: { claim: Claim }) {
  return (
    <div className="facts-grid">
      <div>
        <span>Claim amount</span>
        <strong>{numberFormatter.format(claim.amount)}</strong>
      </div>
      <div>
        <span>Policy limit</span>
        <strong>{numberFormatter.format(claim.policyLimit)}</strong>
      </div>
      <div>
        <span>Information requests</span>
        <strong>{claim.informationRequestCount} / 3</strong>
      </div>
      <div>
        <span>Assigned assessor</span>
        <strong>{claim.assessorId ?? "Not assigned"}</strong>
      </div>
      <div>
        <span>Assessment</span>
        <strong>{claim.assessmentReportComplete ? "Report complete" : "Not complete"}</strong>
      </div>
      <div>
        <span>Payment</span>
        <strong>{claim.paymentRequest?.status ?? "No request"}</strong>
      </div>
    </div>
  );
}

export function App() {
  const [users, setUsers] = useState<readonly DemoUser[]>([]);
  const [claims, setClaims] = useState<readonly ClaimSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [transitions, setTransitions] = useState<readonly TransitionPreview[]>([]);
  const [audit, setAudit] = useState<readonly AuditEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  const loadSelection = useCallback(async (claimId: string, userId: string) => {
    const [nextClaim, nextTransitions, nextAudit, nextClaims] = await Promise.all([
      api.getClaim(claimId),
      api.getTransitions(claimId, userId),
      api.getAudit(claimId),
      api.listClaims(),
    ]);
    setClaim(nextClaim);
    setTransitions(nextTransitions);
    setAudit(nextAudit);
    setClaims(nextClaims);
  }, []);

  const reload = useCallback(async () => {
    if (selectedClaimId === "" || selectedUserId === "") return;
    setDetailLoading(true);
    setError(null);
    try {
      await loadSelection(selectedClaimId, selectedUserId);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, "UNEXPECTED_CLIENT_ERROR", String(caught), undefined),
      );
    } finally {
      setDetailLoading(false);
    }
  }, [loadSelection, selectedClaimId, selectedUserId]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const [nextUsers, nextClaims] = await Promise.all([api.listUsers(), api.listClaims()]);
        if (!active) return;
        setUsers(nextUsers);
        setClaims(nextClaims);
        setSelectedUserId(nextUsers[0]?.id ?? "");
        setSelectedClaimId(nextClaims[0]?.id ?? "");
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof ApiError
              ? caught
              : new ApiError(0, "UNEXPECTED_CLIENT_ERROR", String(caught), undefined),
          );
        }
      } finally {
        if (active) setInitialLoading(false);
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedClaimId === "" || selectedUserId === "") return;
    void reload();
  }, [reload, selectedClaimId, selectedUserId]);

  async function mutate(
    actionName: string,
    successTitle: string,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    if (pendingAction !== null) return;
    setPendingAction(actionName);
    setError(null);
    setNotice(null);
    try {
      const result = await operation();
      await loadSelection(selectedClaimId, selectedUserId);
      const warnings =
        typeof result === "object" && result !== null && "effectWarnings" in result
          ? (result as TransitionResult).effectWarnings
          : [];
      setNotice({
        title: successTitle,
        message:
          warnings.length > 0
            ? "The workflow transition succeeded and the claim data was refreshed. A mock after-commit effect reported a failure."
            : "The claim, outgoing transitions, and audit history have been refreshed.",
        ...(warnings.length === 0 ? {} : { warnings }),
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, "UNEXPECTED_CLIENT_ERROR", String(caught), undefined),
      );
    } finally {
      setPendingAction(null);
    }
  }

  if (initialLoading) {
    return (
      <main className="loading-shell" aria-busy="true">
        <div className="loading-mark">CL</div>
        <p>Opening the workflow desk…</p>
      </main>
    );
  }

  if (claims.length === 0 && error === null) {
    return (
      <main className="empty-page">
        <p className="brand">Claimline</p>
        <h1>No sample claims found</h1>
        <p>Run the demo seed command, then refresh this page.</p>
        <button className="button button-dark" type="button" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Claimline workflow desk">
          <span>CL</span> Claimline
        </a>
        <div className="identity-control">
          <label htmlFor="demo-user">Working as</label>
          <select
            id="demo-user"
            value={selectedUserId}
            onChange={(event) => {
              setNotice(null);
              setSelectedUserId(event.currentTarget.value);
            }}
            disabled={pendingAction !== null}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
          {selectedUser !== null && <span className="active-role">{selectedUser.role}</span>}
        </div>
      </header>

      <div className="workspace" id="top">
        <aside className="claim-rail" aria-label="Sample claims">
          <div className="rail-heading">
            <div>
              <p className="eyebrow">Demo workspace</p>
              <h1>Claims</h1>
            </div>
            <span>{String(claims.length).padStart(2, "0")}</span>
          </div>
          <nav>
            {claims.map((summary) => (
              <button
                type="button"
                className={summary.id === selectedClaimId ? "claim-link active" : "claim-link"}
                key={summary.id}
                onClick={() => {
                  setNotice(null);
                  setSelectedClaimId(summary.id);
                }}
                aria-current={summary.id === selectedClaimId ? "page" : undefined}
                disabled={pendingAction !== null}
              >
                <span className="claim-monogram">{shortId(summary.id).slice(0, 2)}</span>
                <span>
                  <strong>Claim {shortId(summary.id)}</strong>
                  <small>{summary.stateLabel}</small>
                </span>
                <span className="claim-amount">{numberFormatter.format(summary.amount)}</span>
              </button>
            ))}
          </nav>
          <div className="rail-note">
            <span className="pulse" />
            Demo API connected
          </div>
        </aside>

        <main className="claim-main">
          {error !== null && <ErrorPanel error={error} onRetry={() => void reload()} />}
          {notice !== null && <NoticePanel notice={notice} />}

          {detailLoading && claim === null ? (
            <section className="detail-loading" aria-busy="true">
              <div />
              <div />
              <div />
            </section>
          ) : claim !== null ? (
            <>
              <section className="claim-hero">
                <div>
                  <p className="eyebrow">Claim {shortId(claim.id)}</p>
                  <h2>{claim.stateLabel}</h2>
                  <p className="claim-id">{claim.id}</p>
                </div>
                <div className="state-seal" aria-label={`Current state: ${claim.stateLabel}`}>
                  <span>Current state</span>
                  <strong>{claim.stateLabel}</strong>
                </div>
              </section>

              <section className="panel facts-panel" aria-labelledby="claim-data-heading">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Read-only record</p>
                    <h2 id="claim-data-heading">Claim data</h2>
                  </div>
                  <span>State, counters, audit and policy limit are server-controlled</span>
                </div>
                <ClaimFacts claim={claim} />
                {(claim.currentInformationRequestDescription !== null ||
                  claim.rejectionReason !== null ||
                  claim.paymentRequest?.paymentReference !== null) && (
                  <div className="record-notes">
                    {claim.currentInformationRequestDescription !== null && (
                      <p>
                        <span>Current information request</span>
                        {claim.currentInformationRequestDescription}
                      </p>
                    )}
                    {claim.rejectionReason !== null && (
                      <p>
                        <span>Rejection reason</span>
                        {claim.rejectionReason}
                      </p>
                    )}
                    {claim.paymentRequest?.paymentReference != null && (
                      <p>
                        <span>Payment reference</span>
                        {claim.paymentRequest.paymentReference}
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section className="two-column">
                <div className="panel" aria-labelledby="prepare-heading">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Step 01</p>
                      <h2 id="prepare-heading">Prepare the claim</h2>
                    </div>
                  </div>
                  {claim.state === "SUBMITTED" && (
                    <DocumentsForm
                      claim={claim}
                      pending={pendingAction !== null}
                      onSave={(documents) =>
                        mutate("documents", "Document status saved", () =>
                          api.setDocuments(claim.id, selectedUserId, documents),
                        )
                      }
                    />
                  )}
                  {claim.state === "DOCUMENTS_VERIFIED" && (
                    <AssessorForm
                      users={users}
                      pending={pendingAction !== null}
                      onSave={(assessorId) =>
                        mutate("assessor", "Assessor assigned", () =>
                          api.assignAssessor(claim.id, selectedUserId, assessorId),
                        )
                      }
                    />
                  )}
                  {claim.state === "UNDER_ASSESSMENT" && (
                    <AssessmentForm
                      pending={pendingAction !== null}
                      onSave={(report) =>
                        mutate("assessment", "Assessment report completed", () =>
                          api.completeAssessment(claim.id, selectedUserId, report),
                        )
                      }
                    />
                  )}
                  {claim.state === "PENDING_INFO" && (
                    <AdditionalInformationForm
                      pending={pendingAction !== null}
                      onSave={(isValid, metadata) =>
                        mutate("information", "Additional information recorded", () =>
                          api.recordAdditionalInformation(
                            claim.id,
                            selectedUserId,
                            isValid,
                            metadata,
                          ),
                        )
                      }
                    />
                  )}
                  {claim.state === "PAYMENT_INITIATED" && (
                    <PaymentForm
                      pending={pendingAction !== null}
                      onSave={(reference) =>
                        mutate("payment", "Payment confirmed", () =>
                          api.confirmPayment(claim.id, selectedUserId, reference),
                        )
                      }
                    />
                  )}
                  {![
                    "SUBMITTED",
                    "DOCUMENTS_VERIFIED",
                    "UNDER_ASSESSMENT",
                    "PENDING_INFO",
                    "PAYMENT_INITIATED",
                  ].includes(claim.state) && (
                    <div className="empty-state compact">
                      <span>✓</span>
                      <h3>No prerequisite form for this state</h3>
                      <p>Use an outgoing action or the fixed demo operations when available.</p>
                    </div>
                  )}
                </div>

                <div className="panel" aria-labelledby="transitions-heading">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Step 02</p>
                      <h2 id="transitions-heading">Outgoing transitions</h2>
                    </div>
                    <span>{transitions.length} available from this state</span>
                  </div>
                  <div className="transition-stack">
                    {transitions.length === 0 ? (
                      <div className="empty-state compact">
                        <span>—</span>
                        <h3>No outgoing transitions</h3>
                        <p>This claim has reached a terminal state.</p>
                      </div>
                    ) : (
                      transitions.map((transition) => (
                        <TransitionCard
                          key={transition.transitionId}
                          transition={transition}
                          pending={pendingAction !== null}
                          onRun={(input) =>
                            mutate("transition", `${transition.transitionLabel} completed`, () =>
                              api.transition(claim.id, selectedUserId, input),
                            )
                          }
                        />
                      ))
                    )}
                  </div>
                </div>
              </section>

              {claim.state === "REJECTED" && (
                <section className="operations-grid" aria-label="Fixed demo operations">
                  <div className="operation-card member-operation">
                    <p className="eyebrow">Fixed member operation</p>
                    <h2>Record acknowledgement</h2>
                    <p>This operation records the demo member’s acknowledgement. It does not use the selected demo user.</p>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={pendingAction !== null || claim.memberAcknowledgedRejection}
                      onClick={() =>
                        void mutate("acknowledgement", "Member acknowledgement recorded", () =>
                          api.acknowledgeRejection(claim.id),
                        )
                      }
                    >
                      {claim.memberAcknowledgedRejection ? "Acknowledged" : "Record acknowledgement"}
                    </button>
                  </div>
                  <div className="operation-card system-operation">
                    <div className="system-badge">SYS</div>
                    <p className="eyebrow">System demo · separate actor</p>
                    <h2>Run eligible system action</h2>
                    <p>
                      Runs as <code>demo-system/system</code>, independently of the demo-user selector.
                    </p>
                    <button
                      className="button button-light"
                      type="button"
                      disabled={pendingAction !== null}
                      onClick={() =>
                        void mutate("system", "System action completed", () =>
                          api.runSystemAction(claim.id),
                        )
                      }
                    >
                      Run as demo system
                    </button>
                  </div>
                </section>
              )}

              <section className="panel audit-panel" aria-labelledby="audit-heading">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Immutable history</p>
                    <h2 id="audit-heading">Audit timeline</h2>
                  </div>
                  <span>{audit.length} recorded transition{audit.length === 1 ? "" : "s"}</span>
                </div>
                <AuditTimeline entries={audit} />
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
