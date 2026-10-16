"""AI-powered data extraction using Google Gemini and storage-backed files."""
import asyncio
from google import genai
from google.genai import types
import json
import os
import io
from typing import List, Dict, Any, Optional, Tuple
import logging
from models.extraction import FieldConfig, ExtractionResult
from services.gemini_file_service import part_from_storage_object

logger = logging.getLogger(__name__)

class AIExtractionService:
    def __init__(self, storage_service=None):
        self.storage_service = storage_service
        # Configure Vertex AI (google-genai client)
        project = os.getenv("GOOGLE_CLOUD_PROJECT_ID")
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
        if not project:
            logger.warning("GOOGLE_CLOUD_PROJECT_ID not set; AI extraction will not work")
            self.client = None
        else:
            try:
                # Note: Some google-genai versions do not support types.HttpOptions; omit http_options for compatibility.
                self.client = genai.Client(vertexai=True, project=project, location=location)
            except Exception as e:
                logger.error(f"Failed to initialize Vertex AI client: {e}")
                self.client = None
        # Gemini 4 Argon ignores sampling parameters, so none are sent.
        self.base_model_name = 'gemini-4-argon'

        # Generation defaults (override via env if desired)
        try:
            self.max_output_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "65536"))
        except Exception:
            self.max_output_tokens = 65536

        # Batch protocol settings (for very large outputs)
        self.batch_enabled = os.getenv("GEMINI_BATCH_ENABLED", "true").strip().lower() in ("1", "true", "yes", "y")
        try:
            self.batch_max_rounds = int(os.getenv("GEMINI_BATCH_MAX_ROUNDS", "200"))
        except Exception:
            self.batch_max_rounds = 200
        try:
            self.batch_tail_rows = int(os.getenv("GEMINI_BATCH_TAIL_ROWS", "10"))
        except Exception:
            self.batch_tail_rows = 10
        try:
            self.near_token_ratio = float(os.getenv("GEMINI_NEAR_TOKEN_RATIO", "0.98"))
        except Exception:
            self.near_token_ratio = 0.98
        try:
            self.batch_rows_per_call = int(os.getenv("GEMINI_BATCH_ROWS_PER_CALL", "500"))
        except Exception:
            self.batch_rows_per_call = 500

    def _part_from_file_data(self, file_data: Dict) -> types.Part:
        mime_type = file_data.get("mime_type") or "application/pdf"
        object_name = file_data.get("object_name")
        if object_name and self.storage_service is not None:
            return part_from_storage_object(self.storage_service, object_name, mime_type)

        uri = file_data.get("uri")
        if not uri:
            raise ValueError("Missing storage object or GCS URI for file")
        if not uri.startswith("gs://"):
            raise ValueError(f"Unsupported Gemini file URI: {uri}")
        return types.Part.from_uri(file_uri=uri, mime_type=mime_type)

    def _get_resp_text(self, resp: Any) -> Optional[str]:
        if resp is None:
            return None
        # google-genai responses usually expose .text
        text = getattr(resp, "text", None)
        if isinstance(text, str) and text.strip():
            return text
        # Some versions may only expose candidates[].content.parts[].text
        try:
            candidates = getattr(resp, "candidates", None)
            if isinstance(candidates, list) and candidates:
                cand0 = candidates[0]
                content = getattr(cand0, "content", None)
                parts = getattr(content, "parts", None)
                if isinstance(parts, list):
                    chunks = []
                    for p in parts:
                        t = getattr(p, "text", None)
                        if isinstance(t, str):
                            chunks.append(t)
                    joined = "".join(chunks)
                    if joined.strip():
                        return joined
        except Exception:
            pass
        return None

    def _get_finish_reason(self, resp: Any) -> Optional[str]:
        if resp is None:
            return None
        try:
            candidates = getattr(resp, "candidates", None)
            if isinstance(candidates, list) and candidates:
                fr = getattr(candidates[0], "finish_reason", None)
                if fr is None:
                    return None
                return str(fr)
        except Exception:
            return None
        return None

    def _get_usage_counts(self, resp: Any) -> Dict[str, Optional[int]]:
        """Best-effort token usage extraction across google-genai versions."""
        out: Dict[str, Optional[int]] = {
            "prompt_tokens": None,
            "output_tokens": None,
            "total_tokens": None,
        }
        if resp is None:
            return out

        usage = getattr(resp, "usage_metadata", None) or getattr(resp, "usage", None)
        if usage is None:
            return out

        # usage may be a dict-like or an object.
        if isinstance(usage, dict):
            get = usage.get
            for k in ("prompt_token_count", "prompt_tokens", "input_tokens"):
                if isinstance(get(k), int):
                    out["prompt_tokens"] = get(k)
                    break
            for k in ("candidates_token_count", "output_tokens", "completion_tokens"):
                if isinstance(get(k), int):
                    out["output_tokens"] = get(k)
                    break
            for k in ("total_token_count", "total_tokens"):
                if isinstance(get(k), int):
                    out["total_tokens"] = get(k)
                    break
            return out

        # Object form
        for attr, key in (
            ("prompt_token_count", "prompt_tokens"),
            ("prompt_tokens", "prompt_tokens"),
            ("input_tokens", "prompt_tokens"),
        ):
            v = getattr(usage, attr, None)
            if isinstance(v, int):
                out[key] = v
                break
        for attr, key in (
            ("candidates_token_count", "output_tokens"),
            ("output_tokens", "output_tokens"),
            ("completion_tokens", "output_tokens"),
        ):
            v = getattr(usage, attr, None)
            if isinstance(v, int):
                out[key] = v
                break
        for attr, key in (
            ("total_token_count", "total_tokens"),
            ("total_tokens", "total_tokens"),
        ):
            v = getattr(usage, attr, None)
            if isinstance(v, int):
                out[key] = v
                break

        return out

    def _looks_truncated(self, resp: Any, parsed_ok: bool, text: Optional[str], parse_exc: Optional[Exception] = None) -> bool:
        """Heuristic truncation detection for continuation protocol."""
        finish_reason = (self._get_finish_reason(resp) or "").upper()
        if "MAX_TOKENS" in finish_reason or "LENGTH" in finish_reason:
            return True

        usage = self._get_usage_counts(resp)
        out_tokens = usage.get("output_tokens")
        if isinstance(out_tokens, int) and self.max_output_tokens:
            try:
                if out_tokens >= int(self.max_output_tokens * self.near_token_ratio):
                    return True
            except Exception:
                pass

        if not parsed_ok and parse_exc is not None:
            # JSON cut-off tends to surface as JSONDecodeError or a generic ValueError from our parser.
            msg = str(parse_exc).lower()
            if "unterminated" in msg or "expecting" in msg or "eof" in msg or "end of" in msg:
                return True

        if isinstance(text, str) and text:
            # Incomplete JSON often ends without a closing brace/bracket.
            stripped = text.rstrip()
            if stripped and stripped[-1] not in ("}", "]"):
                # Only treat as truncation if we were unable to parse strictly.
                if not parsed_ok:
                    return True

        return False

    def _normalize_rows(self, rows: List[Any], n_cols: int) -> List[List[Any]]:
        normalized: List[List[Any]] = []
        for row in rows or []:
            if not isinstance(row, list):
                continue
            if len(row) < n_cols:
                row = row + [None] * (n_cols - len(row))
            elif len(row) > n_cols:
                row = row[:n_cols]
            normalized.append(row)
        return normalized

    def _salvage_tabular_rows_from_text(self, text: str, n_cols: int) -> List[List[Any]]:
        """Best-effort recovery of complete rows from a cut-off JSON response.

        Expected shape is: {"results": [[...],[...], ...]}
        If the response is truncated mid-JSON, we salvage only fully-formed row arrays.
        """
        if not isinstance(text, str) or not text:
            return []

        # Find the start of the results array.
        key_idx = text.find('"results"')
        if key_idx == -1:
            key_idx = text.find("'results'")
        if key_idx == -1:
            return []

        bracket_idx = text.find("[", key_idx)
        if bracket_idx == -1:
            return []

        i = bracket_idx + 1
        dec = json.JSONDecoder()
        rows: List[Any] = []

        while i < len(text):
            # Skip whitespace and commas
            while i < len(text) and text[i] in " \t\r\n,":
                i += 1
            if i >= len(text):
                break
            # End of results array
            if text[i] == "]":
                break
            try:
                val, end = dec.raw_decode(text, i)
            except Exception:
                break
            rows.append(val)
            i = end

        return self._normalize_rows([r for r in rows if isinstance(r, list)], n_cols)

    def _row_key(self, row: List[Any]) -> str:
        # Stable, compact representation for dedupe.
        try:
            return json.dumps(row, separators=(",", ":"), ensure_ascii=True, sort_keys=False)
        except Exception:
            return str(row)

    def _compute_suffix_prefix_overlap(self, a: List[List[Any]], b: List[List[Any]], max_k: int) -> int:
        """Return k where suffix(a,k) == prefix(b,k), preferring largest k.

        This is used to merge continuation batches without globally de-duping rows.
        Global de-dupe is unsafe because identical rows can legitimately appear multiple
        times in a document.
        """
        if not a or not b:
            return 0
        if max_k <= 0:
            return 0

        max_k = min(max_k, len(a), len(b))
        # Compare via stable row keys to avoid issues with JSON scalar types.
        a_keys_suffix = [self._row_key(r) for r in a[-max_k:]]
        b_keys_prefix = [self._row_key(r) for r in b[:max_k]]
        for k in range(max_k, 0, -1):
            if a_keys_suffix[-k:] == b_keys_prefix[:k]:
                return k
        return 0

    def _looks_like_restart_from_beginning(self, accumulated: List[List[Any]], new_rows: List[List[Any]]) -> bool:
        """Heuristic: model restarted and is re-emitting from the start.

        We avoid global de-dupe, so this helps prevent runaway duplication if the model
        ignores continuation instructions.
        """
        if not accumulated or not new_rows:
            return False
        # Only apply once we have meaningful history.
        if len(accumulated) < 50 or len(new_rows) < 10:
            return False
        k = 10
        try:
            a0 = [self._row_key(r) for r in accumulated[:k]]
            b0 = [self._row_key(r) for r in new_rows[:k]]
            return a0 == b0
        except Exception:
            return False

    def _build_continuation_prompt(
        self,
        base_prompt: str,
        columns_json: str,
        n_cols: int,
        prior_rows: List[List[Any]],
        total_returned: int,
        max_rows: int,
    ) -> str:
        prior_json = json.dumps(prior_rows, separators=(",", ":"), ensure_ascii=True)
        max_rows_line = ""
        if isinstance(max_rows, int) and max_rows > 0:
            max_rows_line = f"- Return at most {max_rows} rows in this response.\\n"
        return (
            f"{base_prompt}\n\n"
            "Next batch:\n"
            f"- You previously returned {total_returned} rows for this SAME document.\n"
            "- Continue extracting the next rows that come AFTER the final row in prior_rows below.\n"
            "- Do not restart from the beginning. Do not repeat any rows from prior_rows.\n"
            "- If the next document row is identical to a prior row, include it only when it is a distinct later occurrence.\n"
            "- Keep the same column order and row shape as before.\n"
            f"- Each row must have exactly {n_cols} values.\n"
            f"{max_rows_line}"
            "- Do not summarize, collapse, or omit rows because there are many.\n"
            "- Do not mention output limits or token limits. Return concrete rows only.\n"
            "- If there are no more rows to extract, return {\"results\":[]}.\n\n"
            f"Column order: columns={columns_json}\n\n"
            f"prior_rows (all rows already returned, in order): {prior_json}\n"
        )

    def _build_base_prompt_with_ordering(self, prompt: str, max_rows: int = 0) -> str:
        # Add ordering guidance without changing the output schema.
        max_rows_line = ""
        if isinstance(max_rows, int) and max_rows > 0:
            max_rows_line = f"- This is batch 1. Return at most {max_rows} rows in this response.\n"
        return (
            f"{prompt}\n\n"
            "Additional rules for long outputs:\n"
            "- Output rows in the same order they appear in the document.\n"
            f"{max_rows_line}"
            "- Do not intentionally drop, summarize, or collapse rows because there are many.\n"
            "- Do not mention output limits or token limits. If more rows remain after this batch, stop cleanly after a complete row and the system will request the next batch.\n"
            "- If there are no rows to extract, return {\"results\":[]}.\n"
        )

    def _config_for_continuation(self, response_schema: types.Schema) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
            max_output_tokens=self.max_output_tokens,
        )

    def _parse_or_salvage_rows(self, resp: Any, n_cols: int) -> Tuple[List[List[Any]], bool, Optional[str], Optional[Exception]]:
        """Return (rows, parsed_ok, text, parse_exc)."""
        text = self._get_resp_text(resp)
        try:
            rows = self._parse_tabular_response(resp)
            rows = self._normalize_rows(rows, n_cols)
            return rows, True, text, None
        except Exception as e:
            if isinstance(text, str) and text:
                salvaged = self._salvage_tabular_rows_from_text(text, n_cols)
                if salvaged:
                    return salvaged, False, text, e
            return [], False, text, e

    def _generate_with_continuation(
        self,
        file_parts: List[Any],
        prompt: str,
        columns_json: str,
        response_schema: types.Schema,
        base_config: types.GenerateContentConfig,
        n_cols: int,
        label: str,
    ) -> List[List[Any]]:
        """Synchronous continuation loop (google-genai is sync)."""
        if not self.client:
            raise ValueError("AI service not available - Vertex client not configured")
        # Initial request
        batch_mode = bool(
            self.batch_enabled
            and isinstance(self.batch_rows_per_call, int)
            and self.batch_rows_per_call > 0
        )
        rows_per_call = self.batch_rows_per_call
        initial_prompt = self._build_base_prompt_with_ordering(prompt, rows_per_call if batch_mode else 0)
        resp = self.client.models.generate_content(
            model=self.base_model_name,
            contents=file_parts + [initial_prompt],
            config=base_config,
        )

        rows, parsed_ok, text, parse_exc = self._parse_or_salvage_rows(resp, n_cols)
        truncated = self._looks_truncated(resp, parsed_ok=parsed_ok, text=text, parse_exc=parse_exc)
        finish_reason = self._get_finish_reason(resp)
        usage = self._get_usage_counts(resp)

        logger.info(
            f"Gemini response ({label}): rows={len(rows)}, parsed_ok={parsed_ok}, truncated={truncated}, finish_reason={finish_reason}, usage={usage}"
        )

        all_rows: List[List[Any]] = list(rows)

        if not self.batch_enabled:
            return all_rows
        if not all_rows:
            return all_rows
        full_initial_batch = (
            batch_mode
            and isinstance(self.batch_rows_per_call, int)
            and self.batch_rows_per_call > 0
            and len(rows) >= self.batch_rows_per_call
        )
        if not truncated and not full_initial_batch:
            return all_rows

        cont_config = self._config_for_continuation(response_schema)
        rounds = 0
        no_growth_rounds = 0

        while rounds < self.batch_max_rounds:
            rounds += 1
            cont_prompt = self._build_continuation_prompt(
                base_prompt=prompt,
                columns_json=columns_json,
                n_cols=n_cols,
                prior_rows=all_rows,
                total_returned=len(all_rows),
                max_rows=rows_per_call,
            )
            resp2 = self.client.models.generate_content(
                model=self.base_model_name,
                contents=file_parts + [cont_prompt],
                config=cont_config,
            )
            new_rows, parsed_ok2, text2, parse_exc2 = self._parse_or_salvage_rows(resp2, n_cols)
            truncated2 = self._looks_truncated(resp2, parsed_ok=parsed_ok2, text=text2, parse_exc=parse_exc2)
            finish_reason2 = self._get_finish_reason(resp2)
            usage2 = self._get_usage_counts(resp2)

            # Merge with overlap to avoid dropping legitimate duplicate rows.
            max_overlap = max(1, self.batch_tail_rows)
            overlap = self._compute_suffix_prefix_overlap(all_rows, new_rows, max_k=max_overlap)
            if overlap == 0 and self._looks_like_restart_from_beginning(all_rows, new_rows):
                logger.warning(f"Gemini continuation ({label}) appears to restart from beginning; stopping to avoid duplication")
                break
            effective_overlap = overlap if overlap > 1 else 0
            append_rows = new_rows[effective_overlap:] if effective_overlap else new_rows
            all_rows.extend(append_rows)
            added = len(append_rows)

            logger.info(
                f"Gemini continuation ({label}) round={rounds}: returned={len(new_rows)}, added={added}, total={len(all_rows)}, parsed_ok={parsed_ok2}, truncated={truncated2}, finish_reason={finish_reason2}, usage={usage2}"
            )

            if len(new_rows) == 0:
                break
            if added == 0:
                no_growth_rounds += 1
            else:
                no_growth_rounds = 0

            if no_growth_rounds >= 2:
                # Model is likely repeating; stop to avoid infinite loop.
                break
            full_continuation_batch = (
                isinstance(self.batch_rows_per_call, int)
                and self.batch_rows_per_call > 0
                and len(new_rows) >= self.batch_rows_per_call
            )
            if not truncated2 and not full_continuation_batch:
                break

        return all_rows
    
    def _extract_metadata(self, processed_file) -> Dict[str, Any]:
        """Extract metadata from processed_file, handling different object types"""
        metadata = {}
        if hasattr(processed_file, 'metadata') and processed_file.metadata:
            if hasattr(processed_file.metadata, '__dict__'):
                metadata = processed_file.metadata.__dict__
            elif isinstance(processed_file.metadata, dict):
                metadata = processed_file.metadata
            # If it's neither, metadata remains empty dict
        return metadata
    
    
    def create_tabular_json_schema(self, fields: List[FieldConfig]) -> types.Schema:
        """Create a compact response schema: { results: any[][] }.

        Output contract:
        - Return a JSON object with a single key: "results".
        - results is an array of rows.
        - each row is an array with exactly len(fields) cells, aligned to the provided column order.
        - cells may be string|number|integer|boolean|null.
        """
        n_cols = len(fields)

        cell_schema = types.Schema(
            any_of=[
                types.Schema(type="STRING"),
                types.Schema(type="NUMBER"),
                types.Schema(type="INTEGER"),
                types.Schema(type="BOOLEAN"),
            ],
            nullable=True,
        )

        row_schema = types.Schema(
            type="ARRAY",
            items=cell_schema,
            min_items=n_cols,  # type: ignore[arg-type]
            max_items=n_cols,  # type: ignore[arg-type]
            description=f"A single extracted record with {n_cols} columns",
        )

        results_schema = types.Schema(
            type="ARRAY",
            items=row_schema,
            description="List of extracted records (rows)",
        )

        return types.Schema(
            type="OBJECT",
            properties={"results": results_schema},
            required=["results"],
        )

    def _coerce_parsed_obj(self, obj: Any) -> Any:
        if obj is None:
            return None
        if isinstance(obj, (dict, list, str, int, float, bool)):
            return obj
        if hasattr(obj, "model_dump"):
            try:
                return obj.model_dump()
            except Exception:
                pass
        if hasattr(obj, "dict"):
            try:
                return obj.dict()
            except Exception:
                pass
        return obj

    def _parse_tabular_response(self, resp: Any) -> List[List[Any]]:
        parsed = None
        if resp is not None and hasattr(resp, "parsed"):
            parsed = self._coerce_parsed_obj(getattr(resp, "parsed"))

        if parsed is None:
            text = getattr(resp, 'text', None) if resp is not None else None
            if not text:
                raise ValueError("AI model returned empty response")
            parsed = json.loads(text)
        else:
            parsed = self._coerce_parsed_obj(parsed)

        if not isinstance(parsed, dict) or "results" not in parsed:
            raise ValueError("AI response did not match expected shape: missing 'results'")

        results = parsed.get("results")
        if results is None:
            return []
        if not isinstance(results, list):
            raise ValueError("AI response 'results' is not a list")
        for row in results:
            if not isinstance(row, list):
                raise ValueError("AI response contains a non-array row")
        return results

    async def extract_data_individual(
        self,
        files_data: List[Dict],
        fields: List[FieldConfig],
        data_types_map: Dict[str, Dict],
        system_prompt: str,
        processed_files: Optional[List] = None,
    ) -> ExtractionResult:
        """Extract structured data from files using Vertex AI with JSON schema - process each file separately."""
        if not self.client:
            return ExtractionResult(success=False, error="AI service not available - Vertex client not configured")

        try:
            # Build Vertex response schema (compact tabular output)
            response_schema = self.create_tabular_json_schema(fields)
            config = types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=response_schema,
                max_output_tokens=self.max_output_tokens,
            )

            # Build user instructions
            columns = [field.name for field in fields]
            columns_json = json.dumps(columns)
            field_list = chr(10).join([f"- {field.name} ({field.data_type}): {field.prompt}" for field in fields])
            prompt = f"""{system_prompt}

You are processing one document.

Column order: columns={columns_json}

Rules:
- Each row must have exactly {len(columns)} values, in the same order as columns.
- Unless otherwise specified, use null when a value is missing/unclear.
- Return every non-null field value as a JSON string, regardless of the specified data type.
- Do not include any extra keys besides "results".
- You must extract ALL items from the document, even if there are many.

Fields:
{field_list}
"""

            logger.info("=== VERTEX PROMPT DEBUG (Individual Mode) ===")
            logger.info(f"System prompt: {system_prompt}")
            logger.info(f"Field list: {field_list}")
            logger.info(f"Complete prompt: {prompt}")
            logger.info("=== END VERTEX PROMPT DEBUG ===")

            document_results = []
            all_data = []
            total_rows = 0

            for i, file_data in enumerate(files_data):
                try:
                    logger.info(f"Processing file: {file_data['filename']}")
                    file_part = self._part_from_file_data(file_data)

                    try:
                        extracted_rows = self._generate_with_continuation(
                            file_parts=[file_part],
                            prompt=prompt,
                            columns_json=columns_json,
                            response_schema=response_schema,
                            base_config=config,
                            n_cols=len(columns),
                            label=f"individual:{file_data.get('filename')}",
                        )
                        metadata = {}
                        size_bytes = None
                        if processed_files and i < len(processed_files):
                            processed_file = processed_files[i]
                            metadata = self._extract_metadata(processed_file)
                            if hasattr(processed_file, 'size_bytes'):
                                size_bytes = processed_file.size_bytes

                        individual_data = extracted_rows[0] if extracted_rows else []
                        document_results.append({
                            'filename': file_data['filename'],
                            'success': True,
                            'data': individual_data,
                            'error': None,
                            'original_path': metadata.get('original_path', file_data['filename']),
                            'source_zip': metadata.get('source_zip'),
                            'size_bytes': size_bytes or metadata.get('size_bytes')
                        })

                        all_data.extend(extracted_rows)
                        total_rows += len(extracted_rows)

                    except Exception as e:
                        logger.error(f"Failed to extract/continue for {file_data['filename']}: {e}")
                        metadata = {}
                        size_bytes = None
                        if processed_files and i < len(processed_files):
                            processed_file = processed_files[i]
                            metadata = self._extract_metadata(processed_file)
                            if hasattr(processed_file, 'size_bytes'):
                                size_bytes = processed_file.size_bytes
                        document_results.append({
                            'filename': file_data['filename'],
                            'success': False,
                            'error': f'Failed to extract AI response: {str(e)}',
                            'data': None,
                            'original_path': metadata.get('original_path', file_data['filename']),
                            'source_zip': metadata.get('source_zip'),
                            'size_bytes': size_bytes or metadata.get('size_bytes')
                        })
                except Exception as e:
                    logger.error(f"Failed to process file {file_data.get('filename')}: {e}")
                    metadata = {}
                    size_bytes = None
                    if processed_files and i < len(processed_files):
                        processed_file = processed_files[i]
                        metadata = self._extract_metadata(processed_file)
                        if hasattr(processed_file, 'size_bytes'):
                            size_bytes = processed_file.size_bytes
                    document_results.append({
                        'filename': file_data.get('filename'),
                        'success': False,
                        'error': f'Processing failed: {str(e)}',
                        'data': None,
                        'original_path': metadata.get('original_path', file_data.get('filename')),
                        'source_zip': metadata.get('source_zip'),
                        'size_bytes': size_bytes or metadata.get('size_bytes')
                    })

            successful_docs = [doc for doc in document_results if doc['success']]
            if not successful_docs:
                return ExtractionResult(success=False, error="Failed to extract data from any documents", by_document=document_results)

            return ExtractionResult(success=True, data=all_data, by_document=document_results, rows_extracted=total_rows, ai_model=self.base_model_name)

        except Exception as e:
            logger.error(f"AI extraction failed: {e}")
            return ExtractionResult(success=False, error=f"AI extraction failed: {str(e)}")

    async def extract_data_combined(
        self,
        files_data: List[Dict],
        fields: List[FieldConfig],
        data_types_map: Dict[str, Dict],
        system_prompt: str,
        processed_files: Optional[List] = None,
    ) -> ExtractionResult:
        """Extract structured data from multiple files using Vertex AI in a single request."""
        if not self.client:
            return ExtractionResult(success=False, error="AI service not available - Vertex client not configured")

        try:
            response_schema = self.create_tabular_json_schema(fields)
            config = types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=response_schema,
                max_output_tokens=self.max_output_tokens,
            )

            # Build file parts and names
            file_parts = []
            file_names = []
            for i, file_data in enumerate(files_data):
                try:
                    file_parts.append(self._part_from_file_data(file_data))
                    file_names.append(file_data.get('filename'))
                except ValueError as exc:
                    logger.warning("Skipping invalid file input: %s", exc)

            if not file_parts:
                return ExtractionResult(success=False, error="No valid files to process in combined mode")

            columns = [field.name for field in fields]
            columns_json = json.dumps(columns)
            field_list = chr(10).join([f"- {field.name} ({field.data_type}): {field.prompt}" for field in fields])
            doc_list = chr(10).join([f"Document {i+1}: {name}" for i, name in enumerate(file_names)])
            prompt = f"""{system_prompt}

You are processing {len(file_names)} documents together.

{doc_list}

Extract records from ALL documents.

Column order: columns={columns_json}

Rules:
- Each row must have exactly {len(columns)} values, in the same order as columns.
- Unless otherwise specified, use null when a value is missing/unclear.
- Return every non-null field value as a JSON string, regardless of the specified data type.
- Do not include any extra keys besides "results".
- You must extract ALL items from the document, even if there are many.

Fields:
{field_list}
"""

            logger.info("=== VERTEX PROMPT DEBUG (Combined Mode) ===")
            logger.info(f"System prompt: {system_prompt}")
            logger.info(f"Document list: {doc_list}")
            logger.info(f"Field list: {field_list}")
            logger.info(f"Complete prompt: {prompt}")
            logger.info("=== END VERTEX PROMPT DEBUG ===")

            try:
                extracted_rows = self._generate_with_continuation(
                    file_parts=file_parts,
                    prompt=prompt,
                    columns_json=columns_json,
                    response_schema=response_schema,
                    base_config=config,
                    n_cols=len(columns),
                    label=f"combined:{len(file_names)}_docs",
                )
                return ExtractionResult(success=True, data=extracted_rows, by_document=None, rows_extracted=len(extracted_rows), ai_model=self.base_model_name)

            except Exception as e:
                logger.error(f"Failed to extract/continue for combined processing: {e}")
                return ExtractionResult(success=False, error=f"Failed to extract AI response for combined processing: {str(e)}")

        except Exception as e:
            logger.error(f"Combined AI extraction failed: {e}")
            return ExtractionResult(success=False, error=f"Combined AI extraction failed: {str(e)}")

    async def extract_data_from_files(
        self,
        files_data: List[Dict],
        fields: List[FieldConfig],
        data_types_map: Dict[str, Dict],
        system_prompt: str,
        processed_files: Optional[List] = None,
        processing_mode: str = "individual",
    ) -> ExtractionResult:
        """Route to appropriate extraction method based on processing mode with fallback"""
        if processing_mode == "combined":
            logger.info(f"Using combined processing for {len(files_data)} files")
            try:
                result = await self.extract_data_combined(files_data, fields, data_types_map, system_prompt, processed_files)
                if result.success:
                    return result
                else:
                    logger.warning(f"Combined processing failed: {result.error}. Falling back to individual processing.")
                    # Fall back to individual processing
                    logger.info(f"Falling back to individual processing for {len(files_data)} files")
                    return await self.extract_data_individual(files_data, fields, data_types_map, system_prompt, processed_files)
            except Exception as e:
                logger.error(f"Combined processing failed with exception: {e}. Falling back to individual processing.")
                # Fall back to individual processing
                logger.info(f"Falling back to individual processing for {len(files_data)} files")
                return await self.extract_data_individual(files_data, fields, data_types_map, system_prompt, processed_files)
        else:
            logger.info(f"Using individual processing for {len(files_data)} files")
            return await self.extract_data_individual(files_data, fields, data_types_map, system_prompt, processed_files)
    
    def validate_field_config(self, fields: List[FieldConfig]) -> List[str]:
        """Validate field configuration and return any errors"""
        errors = []
        
        if not fields:
            errors.append("At least one field must be specified")
            return errors
        
        # if len(fields) > 20:
        #     errors.append("Maximum 20 fields allowed per extraction")
        
        field_names = set()
        for i, field in enumerate(fields):
            if not field.name or not field.name.strip():
                errors.append(f"Field {i+1}: Name is required")
            elif field.name in field_names:
                errors.append(f"Field {i+1}: Duplicate field name '{field.name}'")
            else:
                field_names.add(field.name)
            
            if not field.data_type or not field.data_type.strip():
                errors.append(f"Field {i+1}: Data type is required")
            
            if field.prompt and len(field.prompt) > 1500:
                errors.append(f"Field {i+1}: Prompt too long (max 1500 characters)")
        
        return errors
