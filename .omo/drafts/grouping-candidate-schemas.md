# Candidate input schemas

Captured through `tool_schema(name)` for the 27 previously unlisted candidate names on 2026-10-23. Inputs only; not a claim about runtime return types.

## bash

```json
{
  "type": "object",
  "required": [
    "command"
  ],
  "properties": {
    "command": {
      "type": "string",
      "description": "Shell command to execute in a PTY-backed session."
    },
    "timeout": {
      "type": "number",
      "description": "Process kill deadline in seconds (default 1800). Foreground blocking stops at the ~60s window: a command still running then auto-detaches to a live background session instead of being killed. Ignored for run_in_background sessions (they live until exit or kill_bash)."
    },
    "description": {
      "type": "string",
      "description": "Short human-readable label for this command."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run as a persistent background session. Returns a bash_id immediately; query it with bash_output, steer with bash_input, tear down with kill_bash."
    },
    "cols": {
      "type": "number",
      "description": "PTY width in columns (default 120)."
    },
    "rows": {
      "type": "number",
      "description": "PTY height in rows (default 40)."
    }
  }
}
```

## glob

```json
{
  "type": "object",
  "required": [
    "pattern"
  ],
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"
    },
    "path": {
      "type": "string",
      "description": "Directory to search in (default: current directory)"
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of results (default: 1000)"
    }
  }
}
```

## bash_input

```json
{
  "type": "object",
  "required": [
    "bash_id"
  ],
  "properties": {
    "bash_id": {
      "type": "string",
      "description": "Session id returned by a run_in_background bash call."
    },
    "input": {
      "type": "string",
      "description": "Literal text to write to the session's stdin."
    },
    "keys": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Named keys to send, e.g. ['ctrl+c'], ['enter'], ['up']. Sent after `input` when both are given."
    },
    "submit": {
      "type": "boolean",
      "description": "Append Enter (\\r) after `input`. Default true when `input` is a non-empty string."
    }
  }
}
```

## bash_resize

```json
{
  "type": "object",
  "required": [
    "bash_id",
    "cols",
    "rows"
  ],
  "properties": {
    "bash_id": {
      "type": "string",
      "description": "Session id returned by a run_in_background bash call."
    },
    "cols": {
      "type": "number",
      "description": "New PTY width in columns."
    },
    "rows": {
      "type": "number",
      "description": "New PTY height in rows."
    }
  }
}
```

## kill_bash

```json
{
  "type": "object",
  "properties": {
    "bash_id": {
      "type": "string",
      "description": "Session id to tree-kill."
    },
    "all": {
      "type": "boolean",
      "description": "Tree-kill every live background session."
    }
  }
}
```

## monitor

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "create",
        "rearm"
      ],
      "description": "Defaults to create. rearm resumes a monitor paused by the wake budget or the runaway guard."
    },
    "type": {
      "type": "string",
      "enum": [
        "command",
        "path",
        "rpc"
      ],
      "description": "Create: which source to watch; inferred when omitted (command -> command, path -> path, target -> rpc)."
    },
    "target": {
      "type": "string",
      "minLength": 1,
      "description": "Create, rpc branch: \"children\" (sessions this one spawned, including ones spawned later), \"all\" (every session on every host and terminal of this user) or one session id, path or st_ task id."
    },
    "events": {
      "anyOf": [
        {
          "type": "string",
          "const": "all"
        },
        {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      ],
      "description": "Rpc branch: record kinds to report, any RPC record type; default [\"session_status\"] (children: plus \"effect_status\"); \"all\" reports every kind, streaming collapsed to one line per 2 s."
    },
    "exclude": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "Rpc branch with events \"all\": record kinds to drop."
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "Create (required): specific label shown with every event, e.g. 'errors in deploy.log'."
    },
    "command": {
      "type": "string",
      "description": "Create, command branch (XOR path): shell command to run and watch in a PTY-backed monitor session."
    },
    "path": {
      "type": "string",
      "minLength": 1,
      "description": "Create, file branch (XOR command): one regular file to watch natively, whose parent directory must already exist; takes no filter."
    },
    "event": {
      "type": "string",
      "enum": [
        "create",
        "modify"
      ],
      "description": "File branch only: which file event fires the watch (defaults to create)."
    },
    "filter": {
      "type": "string",
      "description": "Only lines matching this regex become monitor events (command output lines, rpc event lines)."
    },
    "timeout_ms": {
      "type": "number",
      "minimum": 1,
      "maximum": 3600000,
      "description": "Watcher deadline in milliseconds (default 300000; ignored when persistent)."
    },
    "persistent": {
      "type": "boolean",
      "description": "Standing watch: no deadline, and it survives a session restart (command re-run once, file rescanned and any detached change reported). Expires 7 days after creation; no per-session cap unless the terminal.maxDurableMonitors setting sets one; stop one with kill_bash."
    },
    "bash_id": {
      "type": "string",
      "description": "Rearm: paused monitor id (mon_ or bash_id) to resume; omit for all paused."
    },
    "wakes_per_hour": {
      "type": "integer",
      "minimum": 1,
      "maximum": 3600,
      "description": "Persistent command branch only: average wakes an hour for this watch (default: terminal.monitorWakesPerHour, 12). Lines matched between wakes are batched into the next one, never dropped; raise it for a chat bridge that needs quicker replies."
    },
    "human_input": {
      "type": "boolean",
      "description": "Command branch only: set true when each output line is a message a person wrote (a chat or inbox bridge). Its deliveries then count as new user input, so a running goal keeps going; leave unset for machine status."
    }
  }
}
```

## schedule_wakeup

```json
{
  "type": "object",
  "required": [
    "reason"
  ],
  "properties": {
    "delaySeconds": {
      "type": "integer",
      "description": "Dynamic loop delay in seconds. Values are clamped to 60-3600."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "description": "Why this wakeup or stop is appropriate. Must not be blank."
    },
    "prompt": {
      "type": "string",
      "description": "Prompt to dispatch when the wakeup fires. Required unless stop is true; preserve the original /loop command verbatim for normal dynamic re-entry."
    },
    "stop": {
      "type": "boolean",
      "description": "End the active dynamic loop immediately instead of scheduling another wakeup."
    },
    "noop": {
      "type": "boolean",
      "description": "True when this iteration observed no actionable change. Consecutive noop iterations are folded in the terminal view. Omit when stopping."
    }
  },
  "additionalProperties": false
}
```

## schedule_prompt

```json
{
  "type": "object",
  "required": [
    "action"
  ],
  "properties": {
    "action": {
      "anyOf": [
        {
          "type": "string",
          "const": "create"
        },
        {
          "type": "string",
          "const": "list"
        },
        {
          "type": "string",
          "const": "cancel"
        }
      ],
      "description": "create a job, list this session's jobs, or cancel one by id."
    },
    "prompt": {
      "type": "string",
      "description": "create: the prompt delivered to this session when the job fires."
    },
    "delaySeconds": {
      "type": "integer",
      "description": "create: fire this many seconds from now."
    },
    "at": {
      "type": "string",
      "description": "create: absolute ISO 8601 date-time with UTC offset to fire at."
    },
    "everySeconds": {
      "type": "integer",
      "description": "create: repeat every N seconds (minimum 60)."
    },
    "id": {
      "type": "string",
      "description": "cancel: the job id (sch_...)."
    }
  },
  "additionalProperties": false
}
```

## workflow

```json
{
  "type": "object",
  "required": [
    "action"
  ],
  "properties": {
    "action": {
      "anyOf": [
        {
          "type": "string",
          "const": "start"
        },
        {
          "type": "string",
          "const": "attach"
        },
        {
          "type": "string",
          "const": "snapshot"
        },
        {
          "type": "string",
          "const": "wait"
        },
        {
          "type": "string",
          "const": "cancel"
        },
        {
          "type": "string",
          "const": "retry"
        },
        {
          "type": "string",
          "const": "send"
        },
        {
          "type": "string",
          "const": "amend"
        }
      ],
      "description": "start creates or reuses a run from a definition; attach re-binds to a live run; snapshot reads current state; wait detaches by default against a live run (the session is woken on node completions and on settle) and blocks only with detach=false; cancel stops it. retry gives failed, cancelled, or skipped nodes a FRESH attempt on the same run (completed nodes keep their results and are never re-run); it requires the run to have settled. send delivers a message to ONE node's child: a running child is steered in place, a finished resident child is revived with its context intact; a child that cannot be continued is refused with node_not_continuable, and retry is then the remedy. amend submits an edited definition for the SAME run: unchanged completed nodes are cache-reused, and only changed or added nodes plus their transitive dependents re-run."
    },
    "definition": {
      "type": "object",
      "required": [
        "key",
        "name",
        "nodes"
      ],
      "properties": {
        "key": {
          "type": "string",
          "description": "Stable idempotency key for this run within the session; re-starting with the same key and definition reuses the existing run."
        },
        "name": {
          "type": "string",
          "description": "Human-readable run name shown in status views."
        },
        "nodes": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id",
              "prompt"
            ],
            "properties": {
              "id": {
                "type": "string",
                "description": "Node id, unique within the definition; referenced by dependsOn."
              },
              "prompt": {
                "type": "string",
                "description": "The instruction for this node's child task. MUST be written in English."
              },
              "label": {
                "type": "string",
                "description": "Short human label for this node."
              },
              "category": {
                "type": "string",
                "description": "Category name routed to the category worker (a fresh worker session configured by the category's model and skills). Mutually exclusive with subagent_type; required unless subagent_type is given."
              },
              "subagent_type": {
                "type": "string",
                "description": "Agent name to invoke directly (e.g. plan-reviewer). Mutually exclusive with category; required unless category is given."
              },
              "model": {
                "type": "string",
                "description": "Explicit model override. Only valid with subagent_type; rejected alongside category, which takes its model from omo.json."
              },
              "dependsOn": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Ids of nodes that must finish before this one is scheduled. Ordering only: no output is substituted into this prompt."
              },
              "task_summary": {
                "type": "string",
                "description": "One-line summary of this node's work, shown in the run widget."
              },
              "description": {
                "type": "string",
                "description": "Short human description of this node."
              },
              "load_skills": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Skill names whose SKILL.md content is prepended to this node's prompt."
              }
            }
          },
          "description": "The nodes of the graph. Each node targets EITHER a category OR a subagent_type."
        }
      },
      "description": "Graph to run. Required for action=start and action=amend, ignored otherwise."
    },
    "run_id": {
      "type": "string",
      "description": "Run id returned by start. Required for attach, snapshot, wait, cancel, retry, send, and amend."
    },
    "reason": {
      "type": "string",
      "description": "Optional human-readable reason recorded when cancelling a run."
    },
    "detach": {
      "type": "boolean",
      "description": "wait only. Defaults to true: against a live run, return immediately with the current snapshot instead of blocking - the session is woken as each node completes and when the run settles. Pass false to block until settle and return the final result; the eval SDK and dag library pass false."
    },
    "node_id": {
      "type": "string",
      "description": "Single node id. Required for send; on retry it selects exactly one node and is mutually exclusive with node_ids."
    },
    "node_ids": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Node ids to retry. retry only, mutually exclusive with node_id; omit both to retry every failed or cancelled node plus the dependents they skipped."
    },
    "message": {
      "type": "string",
      "description": "Message delivered to the node's child. Required for send, ignored otherwise."
    },
    "prompt": {
      "type": "string",
      "description": "Replacement prompt for a retried node. retry only, and only with exactly one node id."
    }
  }
}
```

## workpool

```json
{
  "type": "object",
  "required": [
    "op"
  ],
  "properties": {
    "op": {
      "anyOf": [
        {
          "type": "string",
          "const": "create"
        },
        {
          "type": "string",
          "const": "push"
        },
        {
          "type": "string",
          "const": "close"
        },
        {
          "type": "string",
          "const": "inspect"
        },
        {
          "type": "string",
          "const": "cancel"
        },
        {
          "type": "string",
          "const": "yield"
        }
      ]
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    },
    "agent": {
      "anyOf": [
        {
          "type": "object",
          "required": [
            "category",
            "prompt"
          ],
          "properties": {
            "category": {
              "type": "string",
              "minLength": 1,
              "pattern": "\\S"
            },
            "prompt": {
              "type": "string",
              "minLength": 1,
              "pattern": "\\S"
            },
            "model": {
              "type": "string",
              "minLength": 1,
              "pattern": "\\S"
            }
          },
          "additionalProperties": false
        },
        {
          "type": "object",
          "required": [
            "subagent_type",
            "prompt"
          ],
          "properties": {
            "subagent_type": {
              "type": "string",
              "minLength": 1,
              "pattern": "\\S"
            },
            "prompt": {
              "type": "string",
              "minLength": 1,
              "pattern": "\\S"
            },
            "model": {
              "type": "string",
              "minLength": 1,
              "pattern": "\\S"
            }
          },
          "additionalProperties": false
        }
      ]
    },
    "mode": {
      "anyOf": [
        {
          "type": "string",
          "const": "fresh"
        },
        {
          "type": "string",
          "const": "keep_alive"
        }
      ]
    },
    "tools": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "pattern": "\\S"
      }
    },
    "pool_id": {
      "type": "string",
      "pattern": "^wp_[0-9a-f]{32}$"
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "key",
          "input"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "pattern": "\\S"
          },
          "input": {}
        },
        "additionalProperties": false
      }
    },
    "results": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "required": [
              "key",
              "data"
            ],
            "properties": {
              "key": {
                "type": "string",
                "minLength": 1,
                "pattern": "\\S"
              },
              "data": {}
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "required": [
              "key",
              "error"
            ],
            "properties": {
              "key": {
                "type": "string",
                "minLength": 1,
                "pattern": "\\S"
              },
              "error": {
                "type": "object",
                "required": [
                  "code",
                  "message"
                ],
                "properties": {
                  "code": {
                    "type": "string",
                    "minLength": 1,
                    "pattern": "\\S"
                  },
                  "message": {
                    "type": "string",
                    "minLength": 1,
                    "pattern": "\\S"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        ]
      }
    }
  },
  "additionalProperties": false
}
```

## thread_create

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Display label for the new thread; an existing thread with the same normalized name returns name_conflict, and later renames change only the label while thread_id stays the address."
    },
    "cwd": {
      "type": "string",
      "description": "Working directory the new thread runs in; leaving it unset keeps the thread inside the caller's workspace."
    },
    "fork_from": {
      "type": "string",
      "description": "Durable id of an existing thread to fork; the new thread starts with that transcript as prior context."
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64
      },
      "minItems": 1,
      "maxItems": 16,
      "description": "Names of installed skills the new thread follows from its first turn, as if each were loaded with /skill. A path or text that is not a skill name refuses the create. The new session applies each name its own skill registry holds and logs any it does not; the result's thread.requested_skills echoes the names passed."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_list

```json
{
  "type": "object",
  "properties": {
    "all_scope": {
      "type": "boolean",
      "description": "List threads from every workspace on this machine; the default scope returns only the caller's workspace."
    }
  }
}
```

## thread_read

```json
{
  "type": "object",
  "required": [
    "thread"
  ],
  "properties": {
    "thread": {
      "type": "string",
      "description": "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates."
    },
    "cursor": {
      "type": "string",
      "description": "Opaque cursor from an earlier thread_read to continue a truncated transcript; a transcript revision that moved past it returns cursor_stale."
    },
    "max_bytes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1048576,
      "description": "Byte budget for the returned transcript slice, default 131072 and capped at 1048576; a longer transcript returns truncated with next_cursor."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    }
  }
}
```

## thread_send

```json
{
  "type": "object",
  "required": [
    "thread",
    "message"
  ],
  "properties": {
    "thread": {
      "type": "string",
      "description": "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates."
    },
    "message": {
      "type": "string",
      "maxLength": 32768,
      "description": "Instruction to deliver to the target thread; longer than 32768 UTF-8 bytes returns message_too_large."
    },
    "delivery": {
      "anyOf": [
        {
          "type": "string",
          "const": "auto"
        },
        {
          "type": "string",
          "const": "steer"
        },
        {
          "type": "string",
          "const": "follow_up"
        }
      ],
      "description": "auto steers the running turn when one is active and starts a new turn otherwise; steer requires expected_turn_id and becomes turn_conflict when the active turn changed; follow_up queues the message behind the running turn."
    },
    "expected_turn_id": {
      "type": "string",
      "description": "Turn id the steer applies to; required with delivery steer, and a changed active turn returns turn_conflict with the message held undelivered."
    },
    "summary": {
      "type": "string",
      "maxLength": 200,
      "description": "One-line preview shown to the caller when the completion notice arrives."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    }
  }
}
```

## thread_interrupt

```json
{
  "type": "object",
  "required": [
    "thread"
  ],
  "properties": {
    "thread": {
      "type": "string",
      "description": "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates."
    },
    "turn_id": {
      "type": "string",
      "description": "Running turn to stop, defaulting to the newest running turn; interrupting an idle thread returns success with interrupted false."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    }
  }
}
```

## thread_handoff

```json
{
  "type": "object",
  "required": [
    "thread",
    "message"
  ],
  "properties": {
    "thread": {
      "type": "string",
      "description": "Thread id or name to reopen after a pause; the fuzzy resolver also accepts partial names and workspace basenames, and a close runner-up returns ambiguous_target with candidates."
    },
    "match": {
      "anyOf": [
        {
          "type": "string",
          "const": "exact"
        },
        {
          "type": "string",
          "const": "fuzzy"
        }
      ],
      "description": "exact resolves a thread id or a unique name; fuzzy additionally ranks partial names and workspace basenames and returns the top match only when it clearly leads its runner-up."
    },
    "message": {
      "type": "string",
      "maxLength": 32768,
      "description": "Instruction to deliver to the target thread; longer than 32768 UTF-8 bytes returns message_too_large."
    },
    "delivery": {
      "anyOf": [
        {
          "type": "string",
          "const": "auto"
        },
        {
          "type": "string",
          "const": "steer"
        },
        {
          "type": "string",
          "const": "follow_up"
        }
      ],
      "description": "auto steers the running turn when one is active and starts a new turn otherwise; steer requires expected_turn_id and becomes turn_conflict when the active turn changed; follow_up queues the message behind the running turn."
    },
    "expected_turn_id": {
      "type": "string",
      "description": "Turn id the steer applies to; required with delivery steer, and a changed active turn returns turn_conflict with the message held undelivered."
    },
    "summary": {
      "type": "string",
      "maxLength": 200,
      "description": "One-line preview shown to the caller when the completion notice arrives."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    }
  }
}
```

## thread_rename

```json
{
  "type": "object",
  "required": [
    "thread",
    "name"
  ],
  "properties": {
    "thread": {
      "type": "string",
      "description": "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "New display label for the thread; the thread keeps its id as its address, and a label already used by another visible thread returns name_conflict."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_set_model

```json
{
  "type": "object",
  "required": [
    "thread",
    "model"
  ],
  "properties": {
    "thread": {
      "type": "string",
      "description": "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates."
    },
    "model": {
      "type": "string",
      "minLength": 1,
      "description": "Model to switch the thread to, as provider/id, an exact model id, or a case-insensitive fragment of the id or display name resolved against the host's model catalog; no match returns model_not_found with the available list, several matches return model_ambiguous with candidates."
    },
    "provider": {
      "type": "string",
      "description": "Restricts resolution to one provider when the fragment alone would match models from several providers."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_set_reasoning

```json
{
  "type": "object",
  "required": [
    "thread",
    "level"
  ],
  "properties": {
    "thread": {
      "type": "string",
      "description": "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates."
    },
    "level": {
      "anyOf": [
        {
          "type": "string",
          "const": "off"
        },
        {
          "type": "string",
          "const": "minimal"
        },
        {
          "type": "string",
          "const": "low"
        },
        {
          "type": "string",
          "const": "medium"
        },
        {
          "type": "string",
          "const": "high"
        },
        {
          "type": "string",
          "const": "xhigh"
        },
        {
          "type": "string",
          "const": "max"
        }
      ],
      "description": "Thinking level to apply; a level the thread's active model cannot run returns thinking_level_unsupported with the supported list and leaves the thread unchanged."
    },
    "scope": {
      "anyOf": [
        {
          "type": "string",
          "const": "session"
        },
        {
          "type": "string",
          "const": "turn"
        }
      ],
      "description": "session (default) changes the thread's remembered level for its model; turn changes only the current session level without rewriting the model's remembered level."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_bind

```json
{
  "type": "object",
  "required": [
    "platform",
    "account_id",
    "chat_id"
  ],
  "properties": {
    "platform": {
      "anyOf": [
        {
          "type": "string",
          "const": "discord"
        },
        {
          "type": "string",
          "const": "telegram"
        },
        {
          "type": "string",
          "const": "slack"
        },
        {
          "type": "string",
          "const": "notion"
        },
        {
          "type": "string",
          "const": "feishu"
        },
        {
          "type": "string",
          "const": "herdr"
        },
        {
          "type": "string",
          "const": "custom"
        },
        {
          "type": "string",
          "const": "whatsapp"
        }
      ],
      "description": "Chat platform of the external conversation; custom covers any other connector."
    },
    "account_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Bot or account id the connector speaks as on that platform."
    },
    "chat_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Channel, group or direct-chat id on the platform."
    },
    "thread_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Thread id inside the chat; @chat (the default) binds the whole chat on platforms without threads."
    },
    "root_message_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Platform id of the message that started the thread, when there is one."
    },
    "progress_message_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Platform id of an existing progress message that milestone reports edit in place."
    },
    "session": {
      "type": "string",
      "description": "Thread id or unique name of the session to attach, as returned by thread_list; self or leaving it unset attaches the calling session."
    },
    "direction": {
      "type": "object",
      "required": [
        "inbound",
        "outbound"
      ],
      "properties": {
        "inbound": {
          "type": "boolean"
        },
        "outbound": {
          "type": "boolean"
        }
      },
      "description": "inbound lets the thread's messages reach the session, outbound lets the session report to the thread; both default to true and at least one is required."
    },
    "inbound_mode": {
      "anyOf": [
        {
          "type": "string",
          "const": "auto"
        },
        {
          "type": "string",
          "const": "follow_up"
        }
      ],
      "description": "How inbound messages are delivered: auto starts a turn when the session is idle and queues behind a running one; follow_up always queues behind the running turn."
    },
    "outbound_events": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "string",
            "const": "milestone"
          },
          {
            "type": "string",
            "const": "report"
          },
          {
            "type": "string",
            "const": "question"
          },
          {
            "type": "string",
            "const": "completion"
          }
        ]
      },
      "maxItems": 4,
      "description": "Report kinds this thread receives, each at most once; defaults to all four for an outbound binding."
    },
    "policy_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Connector policy label stored with the binding; default is default."
    },
    "ttl_seconds": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1
        },
        {
          "type": "null"
        }
      ],
      "description": "Lifetime in seconds from now, default 604800 (one week) and never extended; null keeps the binding until it is unbound."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_unbind

```json
{
  "type": "object",
  "required": [
    "binding_id",
    "expected_revision"
  ],
  "properties": {
    "binding_id": {
      "type": "string",
      "minLength": 1,
      "description": "Binding id as returned by thread_bind or thread_bindings."
    },
    "expected_revision": {
      "type": "integer",
      "minimum": 1,
      "description": "Revision the caller last saw for this binding; a binding that moved since returns stale_revision."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_rebind

```json
{
  "type": "object",
  "required": [
    "binding_id",
    "expected_revision",
    "session"
  ],
  "properties": {
    "binding_id": {
      "type": "string",
      "minLength": 1,
      "description": "Binding id as returned by thread_bind or thread_bindings."
    },
    "expected_revision": {
      "type": "integer",
      "minimum": 1,
      "description": "Revision the caller last saw for this binding; a binding that moved since returns stale_revision."
    },
    "session": {
      "type": "string",
      "minLength": 1,
      "description": "Thread id or unique name of the session that takes the binding over, as returned by thread_list."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_bindings

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "string",
      "minLength": 1,
      "description": "Only bindings attached to this session (thread id, unique name, or self)."
    },
    "platform": {
      "anyOf": [
        {
          "type": "string",
          "const": "discord"
        },
        {
          "type": "string",
          "const": "telegram"
        },
        {
          "type": "string",
          "const": "slack"
        },
        {
          "type": "string",
          "const": "notion"
        },
        {
          "type": "string",
          "const": "feishu"
        },
        {
          "type": "string",
          "const": "herdr"
        },
        {
          "type": "string",
          "const": "custom"
        },
        {
          "type": "string",
          "const": "whatsapp"
        }
      ],
      "description": "Chat platform of the external conversation; custom covers any other connector."
    },
    "account_id": {
      "type": "string",
      "minLength": 1,
      "description": "Only bindings of this platform account."
    },
    "chat_id": {
      "type": "string",
      "minLength": 1,
      "description": "Only bindings in this chat."
    },
    "thread_id": {
      "type": "string",
      "minLength": 1,
      "description": "Only bindings of this thread id."
    },
    "status": {
      "anyOf": [
        {
          "type": "string",
          "const": "active"
        },
        {
          "type": "string",
          "const": "detached"
        },
        {
          "type": "string",
          "const": "expired"
        }
      ],
      "description": "Only bindings in this status; all statuses when unset."
    },
    "cursor": {
      "type": "string",
      "description": "next_cursor from an earlier thread_bindings call, to continue the same snapshot."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200,
      "description": "Page size, default 50 and at most 200."
    },
    "all_scope": {
      "type": "boolean",
      "description": "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied."
    }
  }
}
```

## thread_report

```json
{
  "type": "object",
  "required": [
    "kind",
    "text"
  ],
  "properties": {
    "binding_id": {
      "type": "string",
      "minLength": 1,
      "description": "Binding to report to; defaults to the originating binding, the one the message this session is answering now arrived through; refused when that is ambiguous."
    },
    "kind": {
      "anyOf": [
        {
          "type": "string",
          "const": "milestone"
        },
        {
          "type": "string",
          "const": "report"
        },
        {
          "type": "string",
          "const": "question"
        },
        {
          "type": "string",
          "const": "completion"
        }
      ],
      "description": "milestone updates the thread's progress message, report posts a result, question relays a pending question of this session and returns a reply_token, completion is written once when this session's run settles, with the run's real outcome."
    },
    "text": {
      "type": "string",
      "description": "Text relayed to or from the external thread; longer than 32768 UTF-8 bytes returns message_too_large."
    },
    "request_id": {
      "type": "string",
      "minLength": 1,
      "description": "For kind question: the id of this session's pending extension UI request the answer resolves."
    },
    "request_kind": {
      "anyOf": [
        {
          "type": "string",
          "const": "question"
        },
        {
          "type": "string",
          "const": "select"
        },
        {
          "type": "string",
          "const": "confirm"
        },
        {
          "type": "string",
          "const": "input"
        },
        {
          "type": "string",
          "const": "editor"
        }
      ],
      "description": "For kind question: which extension UI request request_id is. It decides the answer forms thread_answer accepts: confirm takes yes/no (any case, surrounding spaces ignored), input and editor take any text including empty, question and select take non-blank text. Without it the answer goes out in every text form at once, so a question, select, input or editor each reads its own and the text must be non-blank; a yes/no word also goes out as the confirm field, so an undeclared confirm reads yes/no too (any other text reads as no)."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict."
    }
  }
}
```

## thread_outbox

```json
{
  "type": "object",
  "required": [
    "binding_id"
  ],
  "properties": {
    "binding_id": {
      "type": "string",
      "minLength": 1,
      "description": "Binding id as returned by thread_bind or thread_bindings."
    },
    "after_cursor": {
      "type": "integer",
      "minimum": 0,
      "description": "Read rows after this cursor; unset continues after the binding's acknowledged cursor."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "description": "Rows per read, default 100 and at most 500."
    }
  }
}
```

## thread_outbox_ack

```json
{
  "type": "object",
  "required": [
    "binding_id",
    "cursor"
  ],
  "properties": {
    "binding_id": {
      "type": "string",
      "minLength": 1,
      "description": "Binding id as returned by thread_bind or thread_bindings."
    },
    "cursor": {
      "type": "integer",
      "minimum": 1,
      "description": "Every outbox row up to this cursor is marked delivered; an older cursor changes nothing."
    },
    "provider_message_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Platform id of the message posted for the row at cursor; the first one for a milestone becomes the progress message later milestones edit."
    }
  }
}
```

## thread_answer

```json
{
  "type": "object",
  "required": [
    "binding_id",
    "reply_token",
    "answer"
  ],
  "properties": {
    "binding_id": {
      "type": "string",
      "minLength": 1,
      "description": "Binding the answer arrived through; it must be the binding that asked the question."
    },
    "reply_token": {
      "type": "string",
      "minLength": 1,
      "description": "reply_token of the question row being answered."
    },
    "answer": {
      "type": "string",
      "description": "Text relayed to or from the external thread; longer than 32768 UTF-8 bytes returns message_too_large."
    }
  }
}
```
