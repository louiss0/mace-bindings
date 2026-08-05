from __future__ import annotations

from dataclasses import dataclass
import re
from typing import TypeAlias


type MaceValue = str | int | float | bool | list[MaceValue] | MaceRecord
MaceRecord: TypeAlias = dict[str, MaceValue]


@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    line: int
    column: int


PRECEDENCE = {"||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "**": 7}


def parse_mace(source: str, input_text: str | None = None) -> MaceRecord:
    input_record: MaceRecord = {}
    if input_text:
        input_value = ExpressionParser(tokenize(input_text), {}, {}).parse_expression()
        if not isinstance(input_value, dict):
            raise ValueError("runtime input must be a Mace record literal")
        input_record = input_value
    return FileParser(tokenize(source), input_record).parse_file()


class FileParser:
    def __init__(self, tokens: list[Token], input_record: MaceRecord) -> None:
        self.tokens = tokens
        self.input = input_record
        self.index = 0
        self.variables: MaceRecord = {}

    def parse_file(self) -> MaceRecord:
        if self.is_delimiter():
            self.parse_script()
        if self.match("["):
            self.skip_balanced("[", "]")
        record = self.parse_record(self.variables)
        self.expect("eof")
        return record

    def parse_script(self) -> None:
        self.consume_delimiter()
        while not self.is_delimiter():
            if self.current().kind == "eof":
                self.fail(self.current(), "expected closing script delimiter")
            self.evaluate_declaration(self.collect_declaration())
        self.consume_delimiter()

    def collect_declaration(self) -> list[Token]:
        declaration: list[Token] = []
        depth = 0
        while self.current().kind != "eof":
            if depth == 0 and self.is_delimiter():
                return declaration
            token = self.advance()
            if token.value in {"{", "[", "<", "("}:
                depth += 1
            if token.value in {"}", "]", ">", ")"}:
                depth -= 1
            if token.value == ";" and depth == 0:
                return declaration
            declaration.append(token)
        self.fail(self.current(), "expected declaration terminator")

    def evaluate_declaration(self, declaration: list[Token]) -> None:
        if not declaration or declaration[0].value in {"schema", "alias", "from", "gen_doc", "schema_doc"}:
            return
        assignment = next((index for index, token in enumerate(declaration) if token.value == "="), -1)
        if assignment < 1:
            return
        name = declaration[assignment - 1]
        if name.kind != "identifier":
            self.fail(name, "expected variable name")
        self.variables[name.value] = ExpressionParser(declaration[assignment + 1 :], self.variables, self.input).parse_expression()

    def parse_record(self, self_record: MaceRecord) -> MaceRecord:
        self.expect("{")
        record: MaceRecord = {}
        while not self.match("}"):
            name = self.expect_identifier()
            if self.match(":"):
                expression = self.until_field_end()
                value = ExpressionParser(expression + [self.current()], self.variables, self.input, self_record).parse_expression()
            else:
                value = self.variables.get(name.value)
                if value is None:
                    self.fail(name, f"unknown identifier {name.value}")
            record[name.value] = value
            self_record.update(record)
            self.match(",")
        return record

    def until_field_end(self) -> list[Token]:
        expression: list[Token] = []
        depth = 0
        while self.current().kind != "eof":
            token = self.current()
            if depth == 0 and token.value in {",", "}"}:
                return expression
            self.advance()
            depth += token.value in {"{", "[", "("}
            depth -= token.value in {"}", "]", ")"}
            expression.append(token)
        self.fail(self.current(), "expected field terminator")

    def is_delimiter(self) -> bool:
        if self.current().value != "|":
            return False
        cursor = self.index + 1
        equals = 0
        while re.fullmatch(r"=+", self.tokens[cursor].value if cursor < len(self.tokens) else ""):
            equals += len(self.tokens[cursor].value)
            cursor += 1
        return equals >= 3 and cursor < len(self.tokens) and self.tokens[cursor].value == "|"

    def consume_delimiter(self) -> None:
        self.expect("|")
        equals = 0
        while re.fullmatch(r"=+", self.current().value):
            equals += len(self.advance().value)
        if equals < 3:
            self.fail(self.current(), "expected script delimiter")
        self.expect("|")

    def skip_balanced(self, opening: str, closing: str) -> None:
        depth = 1
        while depth:
            token = self.advance()
            if token.kind == "eof":
                self.fail(token, f"expected {closing}")
            depth += token.value == opening
            depth -= token.value == closing

    def current(self) -> Token: return self.tokens[self.index]
    def advance(self) -> Token:
        token = self.current(); self.index += 1; return token
    def match(self, value: str) -> bool:
        if self.current().value != value: return False
        self.advance(); return True
    def expect(self, value: str) -> Token:
        token = self.current()
        if (value == "eof" and token.kind == "eof") or token.value == value: return self.advance()
        self.fail(token, f"expected {value}")
    def expect_identifier(self) -> Token:
        token = self.advance()
        if token.kind == "identifier": return token
        self.fail(token, "expected field name")
    def fail(self, token: Token, message: str) -> None:
        raise ValueError(f'parser: {message} at {token.line}:{token.column} near {token.value!r}')


class ExpressionParser:
    def __init__(self, tokens: list[Token], variables: MaceRecord, input_record: MaceRecord, self_record: MaceRecord | None = None) -> None:
        self.tokens = tokens
        self.variables = variables
        self.input = input_record
        self.self_record = self_record or {}
        self.index = 0

    def parse_expression(self, minimum: int = 0) -> MaceValue:
        value = self.parse_unary()
        while (precedence := PRECEDENCE.get(self.current().value)) is not None and precedence >= minimum:
            operator = self.advance().value
            right = self.parse_expression(precedence + (0 if operator == "**" else 1))
            value = binary(operator, value, right)
        if minimum == 0 and self.match("?"):
            yes = self.parse_expression(); self.expect(":"); no = self.parse_expression()
            return yes if value else no
        return value

    def parse_unary(self) -> MaceValue:
        if self.match("!"): return not bool(self.parse_unary())
        if self.match("-"): return -number(self.parse_unary())
        if self.match("+"): return number(self.parse_unary())
        return self.parse_primary()

    def parse_primary(self) -> MaceValue:
        token = self.advance()
        if token.kind == "number": return float(token.value) if "." in token.value else int(token.value)
        if token.kind == "string": return interpolate(token.value, self.variables, self.input, self.self_record)
        if token.value == "true": return True
        if token.value == "false": return False
        if token.value == "(":
            value = self.parse_expression(); self.expect(")"); return value
        if token.value == "[": return self.parse_array()
        if token.value == "{": return self.parse_record()
        if token.value == "$": return self.read(self.input, self.expect_identifier())
        if token.kind == "identifier": return self.read(self.variables, token)
        raise ValueError(f'parser: expected expression at {token.line}:{token.column} near {token.value!r}')

    def parse_array(self) -> list[MaceValue]:
        values: list[MaceValue] = []
        while not self.match("]"):
            values.append(self.parse_expression())
            if not self.match(","): self.expect("]")
        return values

    def parse_record(self) -> MaceRecord:
        record: MaceRecord = {}
        while not self.match("}"):
            name = self.expect_identifier()
            record[name.value] = self.parse_expression() if self.match(":") else self.read(self.variables, name)
            if not self.match(","): self.expect("}")
        return record

    def read(self, record: MaceRecord, token: Token) -> MaceValue:
        if token.value not in record: raise ValueError(f"parser: unknown identifier {token.value} at {token.line}:{token.column}")
        return record[token.value]
    def current(self) -> Token: return self.tokens[self.index] if self.index < len(self.tokens) else Token("eof", "", 0, 0)
    def advance(self) -> Token: token = self.current(); self.index += 1; return token
    def match(self, value: str) -> bool:
        if self.current().value != value: return False
        self.advance(); return True
    def expect(self, value: str) -> Token:
        if self.current().value == value: return self.advance()
        token = self.current(); raise ValueError(f'parser: expected {value} at {token.line}:{token.column} near {token.value!r}')
    def expect_identifier(self) -> Token:
        token = self.advance()
        if token.kind == "identifier": return token
        raise ValueError(f'parser: expected identifier at {token.line}:{token.column} near {token.value!r}')


def tokenize(source: str) -> list[Token]:
    pattern = re.compile(r"(?P<space>\s+)|(?P<comment>//[^\n]*|/\*[\s\S]*?\*/)|(?P<string>'(?:\\.|[^'\\\r\n])*'|\"(?:\\.|[^\"\\\r\n])*\")|(?P<number>\d+(?:\.\d+)?)|(?P<identifier>[^\W\d]\w*(?:-[\w]+)*)|(?P<operator>\?\.|\?\?|===|==|!=|<=|>=|&&|\|\||\*\*)|(?P<symbol>.)", re.UNICODE)
    tokens: list[Token] = []
    line = column = 1
    for match in pattern.finditer(source):
        value = match.group(); token_line, token_column = line, column
        line += value.count("\n"); column = len(value.rsplit("\n", 1)[-1]) + 1 if "\n" in value else column + len(value)
        kind = match.lastgroup
        if kind in {"space", "comment"}: continue
        if kind == "string":
            value = bytes(value[1:-1], "utf-8").decode("unicode_escape")
        tokens.append(Token("symbol" if kind in {"operator", "symbol"} else kind or "symbol", value, token_line, token_column))
    tokens.append(Token("eof", "", line, column))
    return tokens


def number(value: MaceValue) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)): raise ValueError("parser: expected numeric value")
    return value

def binary(operator: str, left: MaceValue, right: MaceValue) -> MaceValue:
    if operator == "+": return number(left) + number(right)
    if operator == "-": return number(left) - number(right)
    if operator == "*": return number(left) * number(right)
    if operator == "/": return number(left) / number(right)
    if operator == "%": return number(left) % number(right)
    if operator == "**": return number(left) ** number(right)
    if operator == "==": return left == right
    if operator == "!=": return left != right
    if operator == "<": return number(left) < number(right)
    if operator == "<=": return number(left) <= number(right)
    if operator == ">": return number(left) > number(right)
    if operator == ">=": return number(left) >= number(right)
    if operator == "&&": return bool(left) and bool(right)
    if operator == "||": return bool(left) or bool(right)
    raise ValueError(f"parser: unsupported operator {operator}")

def interpolate(value: str, variables: MaceRecord, input_record: MaceRecord, self_record: MaceRecord) -> str:
    return re.sub(r"\$\((.*?)\)", lambda match: str(ExpressionParser(tokenize(match.group(1)), variables, input_record, self_record).parse_expression()), value)
