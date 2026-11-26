/**
 * Typed browser-side calls for the daily production report. Every change
 * returns the whole report again, already worked out, so the screen never
 * repeats the arithmetic.
 */
import { apiFetch, apiPost } from '@/lib/api/client';
import type { PartDto, ReportDto } from '@/lib/services/production/reports';
import type {
  AddLineInput,
  AddPartInput,
  OpenReportInput,
  RecordHourInput,
  UpdateLineInput,
} from '@/lib/validation/production';

type Data<T> = { data: T };

const base = (id: string) => `/api/production/reports/${id}`;

export async function openReportRequest(input: OpenReportInput) {
  return (await apiPost<Data<{ id: string; created: boolean }>>('/api/production/reports', input))
    .data;
}

export async function addLineRequest(id: string, input: AddLineInput) {
  return (await apiPost<Data<ReportDto>>(`${base(id)}/lines`, input)).data;
}

export async function updateLineRequest(id: string, lineId: string, input: UpdateLineInput) {
  return (
    await apiFetch<Data<ReportDto>>(`${base(id)}/lines/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  ).data;
}

export async function deleteLineRequest(id: string, lineId: string) {
  return (await apiFetch<Data<ReportDto>>(`${base(id)}/lines/${lineId}`, { method: 'DELETE' }))
    .data;
}

export async function recordHourRequest(
  id: string,
  lineId: string,
  slot: number,
  input: RecordHourInput,
) {
  return (
    await apiFetch<Data<ReportDto>>(`${base(id)}/lines/${lineId}/hours/${slot}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  ).data;
}

export async function clearHourRequest(id: string, lineId: string, slot: number) {
  return (
    await apiFetch<Data<ReportDto>>(`${base(id)}/lines/${lineId}/hours/${slot}`, {
      method: 'DELETE',
    })
  ).data;
}

export async function updateRemarksRequest(id: string, remarks: string | null) {
  return (
    await apiFetch<Data<ReportDto>>(base(id), {
      method: 'PATCH',
      body: JSON.stringify({ remarks }),
    })
  ).data;
}

export async function submitReportRequest(id: string) {
  return (await apiPost<Data<ReportDto>>(`${base(id)}/submit`, {})).data;
}

export async function approveReportRequest(id: string) {
  return (await apiPost<Data<ReportDto>>(`${base(id)}/approve`, {})).data;
}

export async function addPartRequest(input: AddPartInput) {
  return (await apiPost<Data<PartDto>>('/api/production/parts', input)).data;
}
