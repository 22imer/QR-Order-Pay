import { anomalyExplanationSchema, type AnomalyEvaluation, type AnomalyExplanation } from '@may-cafe/contracts';
import { config } from '../config/index.js';
import { logger } from '../infrastructure/logger.js';
import { HttpAIProvider, type AIProvider } from '../providers/aiProvider.js';

export async function explainAnomaly(evaluation: AnomalyEvaluation, provider = buildProvider()): Promise<AnomalyExplanation> {
  if (!provider) return fallbackExplanation(evaluation);
  try {
    const raw = await provider.chat([
      {
        role: 'system',
        content: 'Bạn giải thích cảnh báo vận hành. Chỉ dùng bằng chứng JSON được cung cấp. Không khẳng định nguyên nhân; giả thuyết phải ghi là cần kiểm tra. Trả JSON {summary,evidence[],hypotheses[],checks[]}. Không đề xuất tự hủy đơn, hoàn tiền, đổi giá hoặc thay cấu hình.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          detector: evaluation.detector,
          target: evaluation.target,
          windowStart: evaluation.windowStart,
          windowEnd: evaluation.windowEnd,
          observedValue: evaluation.observedValue,
          thresholdValue: evaluation.thresholdValue,
          baselineValue: evaluation.baselineValue,
          sampleCount: evaluation.sampleCount,
          baselineSampleCount: evaluation.baselineSampleCount,
          method: evaluation.method,
          evidence: evaluation.evidence,
        }),
      },
    ], { model: config.ai.model, jsonMode: true, temperature: 0.1 });
    const parsed = anomalyExplanationSchema.omit({ mode: true }).safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error('Anomaly explanation schema invalid');
    return { mode: 'llm', ...parsed.data };
  } catch (error) {
    logger.warn({ err: (error as Error).message, detector: evaluation.detector }, 'anomaly explanation failed; using fallback');
    return fallbackExplanation(evaluation);
  }
}

export function fallbackExplanation(evaluation: AnomalyEvaluation): AnomalyExplanation {
  const label = detectorLabel(evaluation.detector);
  return {
    mode: 'fallback',
    summary: `${label} vượt ngưỡng trong cửa sổ quan sát. Đây là tương quan cần kiểm tra, chưa phải kết luận nguyên nhân.`,
    evidence: [
      `Giá trị quan sát: ${formatValue(evaluation.detector, evaluation.observedValue)}; ngưỡng: ${formatValue(evaluation.detector, evaluation.thresholdValue)}.`,
      `Số mẫu hiện tại/baseline: ${evaluation.sampleCount}/${evaluation.baselineSampleCount}.`,
      `Khoảng dữ liệu: ${evaluation.windowStart} — ${evaluation.windowEnd}.`,
    ],
    hypotheses: ['Lưu lượng, tải hệ thống hoặc quy trình vận hành có thể đã thay đổi; cần đối chiếu log và dữ liệu nghiệp vụ.'],
    checks: ['Tra log theo route và requestId trong cùng khoảng thời gian.', 'Đối chiếu hàng đợi, trạng thái MongoDB và các thay đổi triển khai gần nhất.'],
  };
}

function buildProvider(): AIProvider | null {
  if (config.anomaly.aiMode !== 'live') return null;
  return new HttpAIProvider({ name: config.ai.provider, apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl });
}

function detectorLabel(detector: AnomalyEvaluation['detector']): string {
  return ({
    HTTP_ERROR_RATE: 'Tỷ lệ lỗi HTTP 5xx',
    HTTP_LATENCY_P95: 'Độ trễ HTTP p95',
    PREPARATION_P95: 'Thời gian pha chế p95',
    CANCELLATION_RATE: 'Tỷ lệ hủy đơn',
  } as const)[detector];
}

function formatValue(detector: AnomalyEvaluation['detector'], value: number | null): string {
  if (value === null) return 'chưa đủ dữ liệu';
  if (detector.endsWith('RATE')) return `${(value * 100).toFixed(2)}%`;
  return detector === 'HTTP_LATENCY_P95' ? `${Math.round(value)} ms` : `${Math.round(value)} giây`;
}
