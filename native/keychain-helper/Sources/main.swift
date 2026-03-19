import Foundation
import Security

private enum KeychainFailure: Error {
  case invalidArguments
  case status(OSStatus)
}

private func usage() {
  let message = """
  Usage:
    keychain-helper set <service> <account>
    keychain-helper get <service> <account>
    keychain-helper delete <service> <account>
    keychain-helper list <service>
    keychain-helper export <service>
  """
  FileHandle.standardError.write(Data(message.utf8))
  FileHandle.standardError.write(Data("\n".utf8))
}

private func baseQuery(service: String, account: String? = nil) -> [String: Any] {
  var query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
  ]

  if let account {
    query[kSecAttrAccount as String] = account
  }

  return query
}

private func readInput() -> String {
  String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
}

private func setSecret(service: String, account: String) throws {
  let value = Data(readInput().utf8)
  let query = baseQuery(service: service, account: account)
  let attributes: [String: Any] = [
    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    kSecValueData as String: value,
  ]

  let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
  if updateStatus == errSecSuccess {
    return
  }

  if updateStatus != errSecItemNotFound {
    throw KeychainFailure.status(updateStatus)
  }

  var addQuery = query
  for (key, value) in attributes {
    addQuery[key] = value
  }

  let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
  guard addStatus == errSecSuccess else {
    throw KeychainFailure.status(addStatus)
  }
}

private func getSecret(service: String, account: String) throws -> String {
  var query = baseQuery(service: service, account: account)
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne

  var result: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &result)
  guard status == errSecSuccess else {
    throw KeychainFailure.status(status)
  }

  guard
    let data = result as? Data,
    let value = String(data: data, encoding: .utf8)
  else {
    throw KeychainFailure.status(errSecDecode)
  }

  return value
}

private func deleteSecret(service: String, account: String) throws {
  let status = SecItemDelete(baseQuery(service: service, account: account) as CFDictionary)
  guard status == errSecSuccess else {
    throw KeychainFailure.status(status)
  }
}

private func listSecrets(service: String) throws -> [String] {
  var query = baseQuery(service: service)
  query[kSecReturnAttributes as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitAll

  var result: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &result)
  if status == errSecItemNotFound {
    return []
  }

  guard status == errSecSuccess else {
    throw KeychainFailure.status(status)
  }

  let items = result as? [[String: Any]] ?? []
  return items.compactMap { $0[kSecAttrAccount as String] as? String }.sorted()
}

private func exportSecrets(service: String) throws -> [String: String] {
  var exported: [String: String] = [:]
  for account in try listSecrets(service: service) {
    exported[account] = try getSecret(service: service, account: account)
  }

  return exported
}

private func exitCode(for status: OSStatus) -> Int32 {
  switch status {
  case errSecItemNotFound:
    return 1
  case errSecUserCanceled, errSecInteractionNotAllowed:
    return 2
  default:
    return 3
  }
}

private func printError(_ error: Error) {
  let message: String
  if case let KeychainFailure.status(status) = error {
    message = (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
  } else {
    message = error.localizedDescription
  }

  FileHandle.standardError.write(Data(message.utf8))
  FileHandle.standardError.write(Data("\n".utf8))
}

do {
  let arguments = CommandLine.arguments
  guard arguments.count >= 3 else {
    usage()
    throw KeychainFailure.invalidArguments
  }

  let command = arguments[1]
  let service = arguments[2]

  switch command {
  case "set":
    guard arguments.count == 4 else {
      usage()
      throw KeychainFailure.invalidArguments
    }

    try setSecret(service: service, account: arguments[3])
  case "get":
    guard arguments.count == 4 else {
      usage()
      throw KeychainFailure.invalidArguments
    }

    let value = try getSecret(service: service, account: arguments[3])
    FileHandle.standardOutput.write(Data(value.utf8))
  case "delete":
    guard arguments.count == 4 else {
      usage()
      throw KeychainFailure.invalidArguments
    }

    try deleteSecret(service: service, account: arguments[3])
  case "list":
    guard arguments.count == 3 else {
      usage()
      throw KeychainFailure.invalidArguments
    }

    let value = try JSONSerialization.data(withJSONObject: listSecrets(service: service))
    FileHandle.standardOutput.write(value)
  case "export":
    guard arguments.count == 3 else {
      usage()
      throw KeychainFailure.invalidArguments
    }

    let value = try JSONSerialization.data(withJSONObject: exportSecrets(service: service))
    FileHandle.standardOutput.write(value)
  default:
    usage()
    throw KeychainFailure.invalidArguments
  }
} catch let error as KeychainFailure {
  switch error {
  case .invalidArguments:
    exit(3)
  case let .status(status):
    printError(error)
    exit(exitCode(for: status))
  }
} catch {
  printError(error)
  exit(3)
}
