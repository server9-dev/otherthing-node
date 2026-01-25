/**
 * Security Scanner
 *
 * Pattern-based security scanning for detecting dangerous commands,
 * prompt injection attempts, and other malicious inputs.
 */

// Risk levels for detected threats
export enum RiskLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

// Categories of threats
export enum ThreatCategory {
  FileSystemDestruction = 'filesystem_destruction',
  RemoteCodeExecution = 'remote_code_execution',
  DataExfiltration = 'data_exfiltration',
  SystemModification = 'system_modification',
  NetworkAccess = 'network_access',
  ProcessManipulation = 'process_manipulation',
  PrivilegeEscalation = 'privilege_escalation',
  CommandInjection = 'command_injection',
  PromptInjection = 'prompt_injection',
}

// Threat pattern definition
export interface ThreatPattern {
  name: string;
  pattern: RegExp;
  description: string;
  riskLevel: RiskLevel;
  category: ThreatCategory;
}

// Match result
export interface ThreatMatch {
  pattern: ThreatPattern;
  matchedText: string;
  startPos: number;
  endPos: number;
}

// Scan result
export interface ScanResult {
  safe: boolean;
  riskLevel: RiskLevel | null;
  threats: ThreatMatch[];
  summary: string;
}

// Comprehensive threat patterns
const THREAT_PATTERNS: ThreatPattern[] = [
  // Filesystem destruction
  {
    name: 'rm_rf_root',
    pattern: /rm\s+(-[rf]*[rf][rf]*|--recursive|--force).*[/\\]/gi,
    description: 'Recursive file deletion with rm -rf',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.FileSystemDestruction,
  },
  {
    name: 'rm_rf_system',
    pattern: /rm\s+(-[rf]*[rf][rf]*|--recursive|--force).*(bin|etc|usr|var|sys|proc|dev|boot|lib|opt|srv|tmp)/gi,
    description: 'Recursive deletion of system directories',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.FileSystemDestruction,
  },
  {
    name: 'dd_destruction',
    pattern: /dd\s+.*if=\/dev\/(zero|random|urandom).*of=\/dev\/[sh]d[a-z]/gi,
    description: 'Disk destruction using dd command',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.FileSystemDestruction,
  },
  {
    name: 'format_drive',
    pattern: /(format|mkfs\.[a-z]+)\s+[/\\]dev[/\\][sh]d[a-z]/gi,
    description: 'Formatting system drives',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.FileSystemDestruction,
  },

  // Remote code execution
  {
    name: 'curl_bash_execution',
    pattern: /(curl|wget)\s+.*\|\s*(bash|sh|zsh|fish|csh|tcsh)/gi,
    description: 'Remote script execution via curl/wget piped to shell',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.RemoteCodeExecution,
  },
  {
    name: 'bash_process_substitution',
    pattern: /bash\s*<\s*\(\s*(curl|wget)/gi,
    description: 'Bash process substitution with remote content',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.RemoteCodeExecution,
  },
  {
    name: 'python_remote_exec',
    pattern: /python[23]?\s+-c\s+.*urllib|requests.*exec/gi,
    description: 'Python remote code execution',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.RemoteCodeExecution,
  },
  {
    name: 'powershell_download_exec',
    pattern: /powershell.*DownloadString.*Invoke-Expression/gi,
    description: 'PowerShell remote script execution',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.RemoteCodeExecution,
  },

  // Data exfiltration
  {
    name: 'ssh_key_exfiltration',
    pattern: /(curl|wget).*-d.*\.ssh\/(id_rsa|id_ed25519|id_ecdsa)/gi,
    description: 'SSH key exfiltration',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.DataExfiltration,
  },
  {
    name: 'password_file_access',
    pattern: /(cat|grep|awk|sed).*(\/etc\/passwd|\/etc\/shadow|\.password|\.env)/gi,
    description: 'Password file access',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.DataExfiltration,
  },
  {
    name: 'history_exfiltration',
    pattern: /(curl|wget).*-d.*\.(bash_history|zsh_history|history)/gi,
    description: 'Command history exfiltration',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.DataExfiltration,
  },

  // System modification
  {
    name: 'crontab_modification',
    pattern: /(crontab\s+-e|echo.*>.*crontab|.*>\s*\/var\/spool\/cron)/gi,
    description: 'Crontab modification for persistence',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.SystemModification,
  },
  {
    name: 'systemd_service_creation',
    pattern: /systemctl.*enable|.*\.service.*>\/etc\/systemd/gi,
    description: 'Systemd service creation',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.SystemModification,
  },
  {
    name: 'hosts_file_modification',
    pattern: /echo.*>.*\/etc\/hosts|hosts\.txt/gi,
    description: 'Hosts file modification',
    riskLevel: RiskLevel.Medium,
    category: ThreatCategory.SystemModification,
  },

  // Network access
  {
    name: 'netcat_listener',
    pattern: /nc\s+(-l|-p)\s+\d+/gi,
    description: 'Netcat listener creation',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.NetworkAccess,
  },
  {
    name: 'reverse_shell',
    pattern: /(nc|netcat|bash|sh).*-e\s*(bash|sh|\/bin\/bash|\/bin\/sh)/gi,
    description: 'Reverse shell creation',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.NetworkAccess,
  },
  {
    name: 'bash_dev_tcp_shell',
    pattern: /bash\s+-i.*>&\s*\/dev\/tcp\/|\/dev\/tcp\/[0-9.]+\/[0-9]+/gi,
    description: 'Bash reverse shell via /dev/tcp',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.NetworkAccess,
  },
  {
    name: 'ssh_tunnel',
    pattern: /ssh\s+.*-[LRD]\s+\d+:/gi,
    description: 'SSH tunnel creation',
    riskLevel: RiskLevel.Medium,
    category: ThreatCategory.NetworkAccess,
  },

  // Process manipulation
  {
    name: 'kill_security_process',
    pattern: /kill(all)?\s+.*\b(antivirus|firewall|defender|security|monitor)\b/gi,
    description: 'Killing security processes',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.ProcessManipulation,
  },
  {
    name: 'process_injection',
    pattern: /gdb\s+.*attach|ptrace.*PTRACE_POKETEXT/gi,
    description: 'Process injection techniques',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.ProcessManipulation,
  },

  // Privilege escalation
  {
    name: 'sudo_without_password',
    pattern: /echo.*NOPASSWD.*>.*sudoers/gi,
    description: 'Sudo privilege escalation',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.PrivilegeEscalation,
  },
  {
    name: 'suid_binary_creation',
    pattern: /chmod\s+[47][0-7][0-7][0-7]|chmod\s+\+s/gi,
    description: 'SUID binary creation',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.PrivilegeEscalation,
  },
  {
    name: 'docker_privileged_exec',
    pattern: /docker\s+(run|exec).*--privileged/gi,
    description: 'Docker privileged container execution',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.PrivilegeEscalation,
  },

  // Command injection
  {
    name: 'command_substitution',
    pattern: /\$\([^)]*[;&|><][^)]*\)|`[^`]*[;&|><][^`]*`/gi,
    description: 'Command substitution with shell operators',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.CommandInjection,
  },
  {
    name: 'encoded_commands',
    pattern: /(base64|hex|url).*decode.*\|\s*(bash|sh)/gi,
    description: 'Encoded command execution',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.CommandInjection,
  },
  {
    name: 'base64_encoded_shell',
    pattern: /(echo|printf)\s+[A-Za-z0-9+/=]{20,}\s*\|\s*base64\s+-d\s*\|\s*(bash|sh|zsh)/gi,
    description: 'Base64 encoded shell commands',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.CommandInjection,
  },
  {
    name: 'eval_with_variables',
    pattern: /eval\s+\$[A-Za-z_][A-Za-z0-9_]*|\beval\s+.*\$\{/gi,
    description: 'Eval with variable substitution',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.CommandInjection,
  },
  {
    name: 'eval_function_call',
    pattern: /\beval\s*\([^)]*\)|\bexec\s*\([^)]*\)/gi,
    description: 'Dangerous eval/exec function call',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.CommandInjection,
  },

  // Prompt injection patterns
  {
    name: 'ignore_instructions',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    description: 'Prompt injection: ignore previous instructions',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.PromptInjection,
  },
  {
    name: 'new_instructions',
    pattern: /new\s+instructions?:?|your\s+new\s+(task|goal|objective)/gi,
    description: 'Prompt injection: new instructions',
    riskLevel: RiskLevel.Medium,
    category: ThreatCategory.PromptInjection,
  },
  {
    name: 'system_prompt_override',
    pattern: /system\s*:\s*|<\|system\|>|\[SYSTEM\]/gi,
    description: 'Prompt injection: system prompt override attempt',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.PromptInjection,
  },
  {
    name: 'jailbreak_attempt',
    pattern: /\bDAN\b|do\s+anything\s+now|pretend\s+you\s+(are|can)|act\s+as\s+if/gi,
    description: 'Prompt injection: jailbreak attempt',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.PromptInjection,
  },
  {
    name: 'role_override',
    pattern: /you\s+are\s+(now|no\s+longer)|from\s+now\s+on\s+you/gi,
    description: 'Prompt injection: role override',
    riskLevel: RiskLevel.Medium,
    category: ThreatCategory.PromptInjection,
  },

  // Additional dangerous patterns
  {
    name: 'kernel_module_manipulation',
    pattern: /(insmod|rmmod|modprobe).*\.ko/gi,
    description: 'Kernel module manipulation',
    riskLevel: RiskLevel.Critical,
    category: ThreatCategory.SystemModification,
  },
  {
    name: 'memory_dump',
    pattern: /(gcore|gdb.*dump|\/proc\/[0-9]+\/mem)/gi,
    description: 'Memory dumping techniques',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.DataExfiltration,
  },
  {
    name: 'network_scanning',
    pattern: /\b(nmap|masscan|zmap|unicornscan)\b.*-[sS]/gi,
    description: 'Network scanning tools',
    riskLevel: RiskLevel.Medium,
    category: ThreatCategory.NetworkAccess,
  },
  {
    name: 'password_cracking_tools',
    pattern: /\b(john|hashcat|hydra|medusa|brutespray)\b/gi,
    description: 'Password cracking tools',
    riskLevel: RiskLevel.High,
    category: ThreatCategory.PrivilegeEscalation,
  },
];

// Risk level priority for sorting
const RISK_PRIORITY: Record<RiskLevel, number> = {
  [RiskLevel.Critical]: 4,
  [RiskLevel.High]: 3,
  [RiskLevel.Medium]: 2,
  [RiskLevel.Low]: 1,
};

/**
 * Security scanner class
 */
export class SecurityScanner {
  private patterns: ThreatPattern[];
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.patterns = THREAT_PATTERNS;
    this.enabled = enabled;
  }

  /**
   * Scan text for security threats
   */
  scan(text: string): ScanResult {
    if (!this.enabled) {
      return {
        safe: true,
        riskLevel: null,
        threats: [],
        summary: 'Security scanning disabled',
      };
    }

    const threats: ThreatMatch[] = [];

    for (const pattern of this.patterns) {
      // Reset regex state
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(text)) !== null) {
        threats.push({
          pattern,
          matchedText: match[0],
          startPos: match.index,
          endPos: match.index + match[0].length,
        });
      }
    }

    // Sort by risk level (highest first), then by position
    threats.sort((a, b) => {
      const riskDiff = RISK_PRIORITY[b.pattern.riskLevel] - RISK_PRIORITY[a.pattern.riskLevel];
      if (riskDiff !== 0) return riskDiff;
      return a.startPos - b.startPos;
    });

    // Determine overall risk level
    const maxRisk = threats.length > 0
      ? threats.reduce((max, t) =>
          RISK_PRIORITY[t.pattern.riskLevel] > RISK_PRIORITY[max]
            ? t.pattern.riskLevel
            : max,
          threats[0].pattern.riskLevel
        )
      : null;

    // Generate summary
    const summary = this.generateSummary(threats);

    return {
      safe: threats.length === 0,
      riskLevel: maxRisk,
      threats,
      summary,
    };
  }

  /**
   * Quick check if text contains any critical threats
   */
  hasCriticalThreats(text: string): boolean {
    const result = this.scan(text);
    return result.threats.some(t =>
      t.pattern.riskLevel === RiskLevel.Critical || t.pattern.riskLevel === RiskLevel.High
    );
  }

  /**
   * Get confidence score based on risk level
   */
  getConfidenceScore(riskLevel: RiskLevel): number {
    switch (riskLevel) {
      case RiskLevel.Critical: return 0.95;
      case RiskLevel.High: return 0.75;
      case RiskLevel.Medium: return 0.60;
      case RiskLevel.Low: return 0.45;
    }
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(threats: ThreatMatch[]): string {
    if (threats.length === 0) {
      return 'No security threats detected';
    }

    const criticalCount = threats.filter(t => t.pattern.riskLevel === RiskLevel.Critical).length;
    const highCount = threats.filter(t => t.pattern.riskLevel === RiskLevel.High).length;
    const categories = [...new Set(threats.map(t => t.pattern.category))];

    let summary = `Detected ${threats.length} threat(s)`;

    if (criticalCount > 0) {
      summary += ` (${criticalCount} CRITICAL)`;
    }
    if (highCount > 0) {
      summary += ` (${highCount} HIGH)`;
    }

    summary += `. Categories: ${categories.join(', ')}`;

    return summary;
  }

  /**
   * Add custom pattern
   */
  addPattern(pattern: ThreatPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Enable/disable scanner
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// Default scanner instance
export const defaultScanner = new SecurityScanner();

// Convenience function
export function scanForThreats(text: string): ScanResult {
  return defaultScanner.scan(text);
}
