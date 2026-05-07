// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

contract DoubleFinancingPreventer {
    struct Asset {
        address owner;
        bool pledged;
        address lender;
        uint256 lienAmount;
    }

    mapping(uint256 => Asset) public assets;
    mapping(address => uint256[]) public assetsByOwner;
    mapping(address => bool) public flaggedAccounts;
    address[] public allFlaggedAccounts;

    event AssetRegistered(uint256 indexed assetId, address indexed owner);
    event FinancingRecorded(
        address indexed borrower,
        uint256 indexed assetId,
        uint256 amount,
        address indexed lender
    );
    event LienReleased(uint256 indexed assetId, address indexed borrower);
    event FraudAttemptDetected(
        address indexed borrower,
        uint256 indexed assetId,
        string reason
    );
    event AccountFlagged(address indexed account, string reason);

    function registerAsset(uint256 assetId) external {
        require(assetId > 0, "Invalid asset ID");
        require(
            assets[assetId].owner == address(0),
            "Asset already registered"
        );

        assets[assetId] = Asset({
            owner: msg.sender,
            pledged: false,
            lender: address(0),
            lienAmount: 0
        });

        assetsByOwner[msg.sender].push(assetId);
        emit AssetRegistered(assetId, msg.sender);
    }

    function requestFinancing(uint256 assetId, uint256 amount) external {
        Asset storage asset = assets[assetId];

        require(asset.owner != address(0), "Asset not found");
        require(asset.owner == msg.sender, "Not the asset owner");

        if (asset.pledged) {
            // Flag the account for fraud
            if (!flaggedAccounts[msg.sender]) {
                flaggedAccounts[msg.sender] = true;
                allFlaggedAccounts.push(msg.sender);
                emit AccountFlagged(msg.sender, "Double financing attempt");
            }
            emit FraudAttemptDetected(
                msg.sender,
                assetId,
                "Asset already pledged to another lender"
            );
            return;
        }

        asset.pledged = true;
        asset.lender = msg.sender;
        asset.lienAmount = amount;

        emit FinancingRecorded(asset.owner, assetId, amount, msg.sender);
    }

    function repayAndRelease(uint256 assetId) external payable {
        Asset storage asset = assets[assetId];

        require(asset.owner != address(0), "Asset not found");
        require(asset.pledged, "Asset not pledged");
        require(
            msg.value == asset.lienAmount,
            "Payment must equal lien amount"
        );

        address lender = asset.lender;
        uint256 amount = asset.lienAmount;

        asset.pledged = false;
        asset.lender = address(0);
        asset.lienAmount = 0;

        payable(lender).transfer(amount);
        emit LienReleased(assetId, asset.owner);
    }

    function clearFlaggedAccounts() external {
        for (uint i = 0; i < allFlaggedAccounts.length; i++) {
            flaggedAccounts[allFlaggedAccounts[i]] = false;
        }
        delete allFlaggedAccounts;
    }

    function flagAccount(address account) external {
        require(account != address(0), "Invalid address");
        if (!flaggedAccounts[account]) {
            flaggedAccounts[account] = true;
            allFlaggedAccounts.push(account);
            emit AccountFlagged(account, "Manually flagged for fraud");
        }
    }

    function isAssetFree(uint256 assetId) external view returns (bool) {
        Asset storage asset = assets[assetId];
        if (asset.owner == address(0)) {
            return false;
        }
        return !asset.pledged;
    }

    function getAssetInfo(
        uint256 assetId
    )
        external
        view
        returns (
            address owner,
            bool pledged,
            address lender,
            uint256 lienAmount
        )
    {
        Asset storage asset = assets[assetId];
        return (asset.owner, asset.pledged, asset.lender, asset.lienAmount);
    }

    function getFlaggedAccounts() external view returns (address[] memory) {
        return allFlaggedAccounts;
    }

    function getAssetsByOwner(
        address owner
    ) external view returns (uint256[] memory) {
        return assetsByOwner[owner];
    }
}

