/**
 * 试运营 dry-run 检查汇总
 * Run: npm run smoke:trial-run
 */
import { getDataQualityReport } from "../src/services/data-quality";
import { getSetupChecklist } from "../src/services/setup-checklist";
import { getSystemHealth } from "../src/services/system-health";
import { runTrialRunCheck } from "../src/services/trial-run-check";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("=== Sprint 11 试运营 dry-run 检查 ===\n");

  const [setup, quality, health, trial] = await Promise.all([
    getSetupChecklist(),
    getDataQualityReport({ pageSize: 10 }),
    getSystemHealth(),
    runTrialRunCheck(),
  ]);

  console.log("【试运营准备清单】");
  console.log(
    `  完成率 ${setup.summary.completionRate}% | PASS ${setup.summary.passedCount} | WARNING ${setup.summary.warningCount} | CRITICAL ${setup.summary.criticalCount}`
  );
  if (setup.nextActions.length) {
    console.log("  建议优先：");
    for (const a of setup.nextActions) {
      console.log(`    - ${a.title} → ${a.actionHref}`);
    }
  }

  console.log("\n【数据质量】");
  console.log(
    `  CRITICAL ${quality.summary.criticalCount} | WARNING ${quality.summary.warningCount} | SUGGESTION ${quality.summary.suggestionCount}`
  );
  for (const issue of quality.issues.slice(0, 5)) {
    console.log(`    [${issue.severity}] ${issue.title}: ${issue.message}`);
  }
  if (quality.pagination.total > 5) {
    console.log(`    ... 共 ${quality.pagination.total} 条`);
  }

  console.log("\n【系统健康】");
  console.log(`  状态 ${health.status}`);
  for (const c of health.checks) {
    console.log(`    [${c.status}] ${c.title}: ${c.message}`);
  }

  console.log("\n【端到端链路】");
  console.log(`  状态 ${trial.status}`);
  for (const s of trial.steps) {
    console.log(`    [${s.status}] ${s.title}: ${s.message}`);
  }
  if (trial.recommendedTestProduct) {
    console.log(
      `\n  推荐测试商品：${trial.recommendedTestProduct.name} (SPU ${trial.recommendedTestProduct.spuId})`
    );
  }
  if (trial.warnings.length) {
    console.log("\n  警告：");
    for (const w of trial.warnings) {
      console.log(`    - ${w}`);
    }
  }

  console.log("\n（默认不写库；创建测试订单需显式 --create-test-order，本轮未实现自动下单）");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
