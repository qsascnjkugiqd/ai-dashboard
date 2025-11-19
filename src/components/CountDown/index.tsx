import './style.scss';
import React, { useEffect, useState } from 'react';
import { dashboard, bitable, DashboardState } from '@lark-base-open/js-sdk';
import { Button, ConfigProvider, Select, Spin } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

/** 配置里需要存的内容：3 个字段 ID */
interface IChartConfig {
  behaviorFieldId?: string;   // 行为类型字段
  aiFieldId?: string;         // AI 判定结果字段
  reviewerFieldId?: string;   // 复核员判定结果字段
}

/** 下拉选项结构 */
interface IFieldOption {
  label: string;
  value: string;
}

/** 图表数据结构：每个行为 4 个数 */
interface ILinePoint {
  behavior: string;          // 行为类型
  aiNormal: number;          // AI 判定“正常”的数量
  aiViolation: number;       // AI 判定“违规”的数量
  reviewerNormal: number;    // 复核员判定“正常”的数量
  reviewerViolation: number; // 复核员判定“违规”的数量
}

const defaultConfig: IChartConfig = {};

/** 仪表盘主组件：保留原来的 props 以兼容 App.tsx */
export default function CountDown(props: { bgColor: string }) {
  const { t } = useTranslation();

  // 当前配置（从 dashboard 里读出来）
  const [config, setConfig] = useState<IChartConfig>(defaultConfig);
  // 当前表的全部字段（配置态下拉用）
  const [fieldOptions, setFieldOptions] = useState<IFieldOption[]>([]);
  // 折线图数据
  const [data, setData] = useState<ILinePoint[]>([]);
  // 加载状态
  const [loading, setLoading] = useState(false);

  // 当前是否处于“创建 / 配置”态
  const isConfig =
    dashboard.state === DashboardState.Create ||
    // 某些版本可能没有 Config 枚举，稳妥起见用字符串兜底
    (dashboard.state as any) === 'Config';

  /** 1. 初始化读取配置 */
  useEffect(() => {
    dashboard.getConfig().then((res: any) => {
      if (res?.config) {
        setConfig(res.config as IChartConfig);
      }
    });
  }, []);

  /** 2. 监听配置被其他协同用户修改 */
  useEffect(() => {
    const off = dashboard.onConfigChange((e: any) => {
      if (e?.data?.config) {
        setConfig(e.data.config as IChartConfig);
      }
    });
    return () => {
      off && off();
    };
  }, []);

  /** 3. 配置态：读取字段列表用于下拉 */
  useEffect(() => {
    if (!isConfig) return;

    (async () => {
      const table = await bitable.base.getActiveTable();
      // 不过滤类型，直接把所有字段列出来交给你选
      const metaList = await table.getFieldMetaList();
      const opts: IFieldOption[] = metaList.map((m: any) => ({
        label: m.name,
        value: m.id,
      }));
      setFieldOptions(opts);
    })();
  }, [isConfig]);

  /** 4. 展示态：根据配置的 3 个字段，从多维表汇总数据 */
  useEffect(() => {
    if (isConfig) return; // 配置态不拉数据
    if (!config.behaviorFieldId || !config.aiFieldId || !config.reviewerFieldId) return;

    setLoading(true);

    (async () => {
      try {
        const table = await bitable.base.getActiveTable();
        const recordIdList: string[] = await table.getRecordIdList();

        const behaviorField = await table.getField(config.behaviorFieldId as string);
        const aiField = await table.getField(config.aiFieldId as string);
        const reviewerField = await table.getField(config.reviewerFieldId as string);


        // 以“行为类型”为 key 聚合
        const map: Record<
          string,
          {
            aiNormal: number;
            aiViolation: number;
            reviewerNormal: number;
            reviewerViolation: number;
          }
        > = {};

        for (const recordId of recordIdList) {
          const behaviorRaw = await behaviorField.getValue(recordId);
          const aiRaw = await aiField.getValue(recordId);
          const reviewerRaw = await reviewerField.getValue(recordId);

          const behavior = normalizeText(behaviorRaw);
          if (!behavior) continue; // 没有行为类型就跳过

          if (!map[behavior]) {
            map[behavior] = {
              aiNormal: 0,
              aiViolation: 0,
              reviewerNormal: 0,
              reviewerViolation: 0,
            };
          }

          // 转成字符串，方便比较
          const aiText = normalizeText(aiRaw);
          const reviewerText = normalizeText(reviewerRaw);

          // AI 判定结果：正常 / 违规
          if (aiText === '正常') {
            map[behavior].aiNormal += 1;
          } else if (aiText === '违规') {
            map[behavior].aiViolation += 1;
          }

          // 复核员判定结果：正常 / 违规
          if (reviewerText === '正常') {
            map[behavior].reviewerNormal += 1;
          } else if (reviewerText === '违规') {
            map[behavior].reviewerViolation += 1;
          }
        }

        const result: ILinePoint[] = Object.entries(map).map(
          ([behavior, v]) => ({
            behavior,
            aiNormal: v.aiNormal,
            aiViolation: v.aiViolation,
            reviewerNormal: v.reviewerNormal,
            reviewerViolation: v.reviewerViolation,
          }),
        );

        // 按行为名称排序，让图表更规整
        result.sort((a, b) =>
          a.behavior.localeCompare(b.behavior, 'zh-CN'),
        );

        setData(result);
      } finally {
        setLoading(false);
        // 告诉宿主“已经渲染完了”，方便截图等
        if (typeof (dashboard as any).setRendered === 'function') {
          (dashboard as any).setRendered();
        }
      }
    })();
  }, [
    isConfig,
    config.behaviorFieldId,
    config.aiFieldId,
    config.reviewerFieldId,
  ]);

  // ========== 配置态 UI ==========
  if (isConfig) {
    return (
      <ConfigProvider>
        <div
          className="countdown-config-panel"
          style={{ padding: 16, backgroundColor: props.bgColor }}
        >
          <ConfigItem label="行为类型字段">
            <Select
              style={{ width: '100%' }}
              value={config.behaviorFieldId}
              optionList={fieldOptions}
              placeholder="请选择行为类型字段"
              onChange={(val) =>
                setConfig((c) => ({ ...c, behaviorFieldId: val as string }))
              }
            />
          </ConfigItem>

          <ConfigItem label="AI 判定结果字段">
            <Select
              style={{ width: '100%' }}
              value={config.aiFieldId}
              optionList={fieldOptions}
              placeholder="请选择 AI 判定结果字段"
              onChange={(val) =>
                setConfig((c) => ({ ...c, aiFieldId: val as string }))
              }
            />
          </ConfigItem>

          <ConfigItem label="复核员判定结果字段">
            <Select
              style={{ width: '100%' }}
              value={config.reviewerFieldId}
              optionList={fieldOptions}
              placeholder="请选择复核员判定结果字段"
              onChange={(val) =>
                setConfig((c) => ({ ...c, reviewerFieldId: val as string }))
              }
            />
          </ConfigItem>

          <Button
          theme="solid"
          style={{ marginTop: 16 }}
          onClick={async () => {
            // 把配置写回仪表盘（沿用官方模板写法）
           await dashboard.saveConfig({
            customConfig: config,
            dataConditions: [],
           } as any);
          }}
          >
          {t('confirm') || '保存配置'}
         </Button>

        </div>
      </ConfigProvider>
    );
  }

  // ========== 展示态 UI（四折线图） ==========
  return (
    <ConfigProvider>
      <div
        className="line-chart-wrapper"
        style={{ width: '100%', height: 400, backgroundColor: props.bgColor }}
      >
        {loading ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Spin />
          </div>
        ) : data.length === 0 ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              color: 'var(--semi-color-text-2)',
            }}
          >
            暂无数据，或尚未完成字段配置
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              {/* 横轴：行为类型 */}
              <XAxis dataKey="behavior" />
              {/* 纵轴：统计数量 */}
              <YAxis />
              <Tooltip />
              <Legend />

              {/* AI：正常 */}
              <Line
                type="monotone"
                dataKey="aiNormal"
                name="AI 正常"
                stroke="#82ca9d"
              />
              {/* AI：违规 */}
              <Line
                type="monotone"
                dataKey="aiViolation"
                name="AI 违规"
                stroke="#ff7300"
              />
              {/* 复核员：正常 */}
              <Line
                type="monotone"
                dataKey="reviewerNormal"
                name="复核员正常"
                stroke="#8884d8"
              />
              {/* 复核员：违规 */}
              <Line
                type="monotone"
                dataKey="reviewerViolation"
                name="复核员违规"
                stroke="#d0ed57"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </ConfigProvider>
  );
}

/** 配置面板的小块 */
function ConfigItem(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          marginBottom: 4,
          fontSize: 13,
          color: 'var(--semi-color-text-2)',
        }}
      >
        {props.label}
      </div>
      {props.children}
    </div>
  );
}

/** 尝试把多维表各种类型的值“抠出一个可读字符串” */
function normalizeText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;

  // 单选、多选字段常见结构：数组 / 对象里带 name 或 text
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    return normalizeText(v[0]);
  }
  if (typeof v === 'object') {
    if ('text' in v) return (v as any).text as string;
    if ('name' in v) return (v as any).name as string;
  }

  return String(v);
}
